#!/usr/bin/env node

import { defineCommand, runMain } from "citty";
import {
  readFileSync,
  mkdirSync,
  existsSync,
  cpSync,
  chmodSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { loadConfig } from "./config/loader.js";
import {
  ensureService,
  restartService,
  getAllStatus,
  stopService,
  stopAllServices,
  attachService,
  PortConflictError,
} from "./core/service.js";
import { runWithServices } from "./core/run.js";
import {
  discoverFromTurbo,
  formatDiscoveredConfig,
} from "./discovery/turbo.js";
import {
  getAllWatcherStatuses,
  startServiceWatcher,
  stopServiceWatcher,
  startAllWatchers,
  stopAllWatchers,
  getPendingEvents,
  clearQueue,
} from "./watch/index.js";
import { diagnosePort, formatDiagnosis } from "./utils/diagnose.js";
import { collectLocalPortReport } from "./ports/report.js";
import { listProxyRoutes } from "./proxy/manager.js";
import { caddy } from "./proxy/caddy.js";
import * as proxySystem from "./proxy/system.js";

const { version } = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../package.json"),
    "utf-8",
  ),
) as { version: string };

if (process.platform === "win32" && !process.env.WSL_DISTRO_NAME) {
  console.error(
    "❌ DevMux requires Windows Subsystem for Linux (WSL) on Windows",
  );
  console.error(
    "   Install WSL: https://docs.microsoft.com/en-us/windows/wsl/install",
  );
  console.error("   Then run DevMux from within your WSL environment");
  process.exit(1);
}

const ensure = defineCommand({
  meta: {
    name: "ensure",
    description: "Ensure a service is running (idempotent)",
  },
  args: {
    service: {
      type: "positional",
      description: "Service name",
      required: true,
    },
    timeout: { type: "string", description: "Startup timeout in seconds" },
  },
  async run({ args }) {
    const config = loadConfig();
    try {
      await ensureService(config, args.service, {
        timeout: args.timeout ? parseInt(args.timeout) : undefined,
      });
    } catch (err) {
      if (err instanceof PortConflictError) {
        console.error(`\n⚠️  ${err.message}\n`);
        process.exit(1);
      }
      throw err;
    }
  },
});

const status = defineCommand({
  meta: { name: "status", description: "Show status of all services" },
  args: {
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const config = loadConfig();
    const statuses = await getAllStatus(config);
    const { getDashboardStatus } = await import("./dashboard/index.js");
    const dashStatus = getDashboardStatus();

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            instanceId: config.instanceId || null,
            services: statuses,
            dashboard: dashStatus,
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log("═══════════════════════════════════════");
    console.log("       Service Status");
    if (config.instanceId) {
      console.log(`       Instance: ${config.instanceId}`);
    }
    console.log("═══════════════════════════════════════");
    console.log("");

    for (const s of statuses) {
      const portDisplay = s.resolvedPort ?? s.port;
      const portInfo = portDisplay ? ` (port ${portDisplay})` : "";

      if (s.portConflict) {
        const c = s.portConflict;
        console.log(`⚠️  ${s.name}${portInfo}: PORT CONFLICT`);
        console.log(`   └─ Port ${c.port} is in use by another process:`);
        console.log(`   └─   PID ${c.pid}: ${c.processName}`);
        if (c.processCmd) {
          console.log(`   └─   ${c.processCmd}`);
        }
        if (c.processCwd) {
          console.log(`   └─   Working dir: ${c.processCwd}`);
        }
        console.log(`   └─ This is NOT the ${s.name} service.`);
        console.log(
          `   └─ Run \`kill ${c.pid}\` to free the port, then retry.`,
        );
      } else {
        const icon = s.healthy ? "✅" : "❌";
        console.log(
          `${icon} ${s.name}${portInfo}: ${s.healthy ? "Running" : "Not running"}`,
        );

        if (s.tmuxSession) {
          console.log(`   └─ tmux: ${s.tmuxSession}`);
        } else if (s.healthy) {
          console.log(`   └─ (running outside tmux)`);
        }
      }
      if (s.proxyUrl) {
        console.log(`   └─ ${s.proxyUrl}`);
      }
      console.log("");
    }

    const dashIcon = dashStatus.running ? "✅" : "⚫";
    const dashInfo = dashStatus.running
      ? `Running (port ${dashStatus.port})`
      : "Not running";
    console.log(`${dashIcon} dashboard: ${dashInfo}`);
    if (dashStatus.running) {
      console.log(`   └─ http://localhost:${dashStatus.port}`);
    }
    console.log("");
  },
});

const stop = defineCommand({
  meta: { name: "stop", description: "Stop a service or all services" },
  args: {
    service: { type: "positional", description: "Service name or 'all'" },
    force: { type: "boolean", description: "Also kill processes on ports" },
  },
  async run({ args }) {
    const config = loadConfig();
    const serviceName = args.service ?? "all";

    if (serviceName === "all") {
      stopAllServices(config, { killPorts: args.force });
      const { getDashboardStatus, stopDashboardServer } =
        await import("./dashboard/index.js");
      if (getDashboardStatus().running) {
        stopDashboardServer();
      }
    } else {
      stopService(config, serviceName, { killPorts: args.force });
    }
  },
});

const restart = defineCommand({
  meta: { name: "restart", description: "Restart a service (stop + start)" },
  args: {
    service: {
      type: "positional",
      description: "Service name",
      required: true,
    },
    timeout: { type: "string", description: "Startup timeout in seconds" },
    force: {
      type: "boolean",
      description: "Also kill processes on ports before restarting",
    },
  },
  async run({ args }) {
    const config = loadConfig();
    await restartService(config, args.service, {
      timeout: args.timeout ? parseInt(args.timeout) : undefined,
      killPorts: args.force,
    });
  },
});

async function pickServiceFzf(
  services: { name: string; port?: number }[],
): Promise<string | undefined> {
  const lines = services
    .map((s) => (s.port ? `${s.name} :${s.port}` : s.name))
    .join("\n");

  try {
    const result = await execa(
      "fzf",
      [
        "--height=40%",
        "--layout=reverse",
        "--border",
        "--prompt=devmux> ",
        "--header=Select service to start (Enter=start, Esc=cancel)",
      ],
      {
        input: lines,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "inherit",
        reject: false,
      },
    );

    if (result.exitCode !== 0 || !result.stdout.trim()) {
      return undefined;
    }

    const selected = result.stdout.trim().split(/\s/)[0];
    return selected || undefined;
  } catch {
    console.error("❌ fzf not found. Install with: brew install fzf");
    return undefined;
  }
}

const start = defineCommand({
  meta: { name: "start", description: "Start a service (alias for ensure)" },
  args: {
    service: {
      type: "positional",
      description: "Service name (omit for interactive picker)",
      required: false,
    },
    timeout: { type: "string", description: "Startup timeout in seconds" },
  },
  async run({ args }) {
    const config = loadConfig();
    let serviceName = args.service as string | undefined;

    if (!serviceName) {
      const services = Object.entries(config.services).map(([name, def]) => ({
        name,
        port:
          def.port ??
          (def.health?.type === "port" ? def.health.port : undefined),
      }));

      if (services.length === 0) {
        console.error("❌ No services defined in devmux config");
        process.exit(1);
      }

      serviceName = await pickServiceFzf(services);
      if (!serviceName) {
        console.log("Cancelled.");
        process.exit(0);
      }
    }

    try {
      await ensureService(config, serviceName, {
        timeout: args.timeout ? parseInt(args.timeout) : undefined,
      });
    } catch (err) {
      if (err instanceof PortConflictError) {
        console.error(`\n⚠️  ${err.message}\n`);
        process.exit(1);
      }
      throw err;
    }
  },
});

const attach = defineCommand({
  meta: { name: "attach", description: "Attach to a service's tmux session" },
  args: {
    service: {
      type: "positional",
      description: "Service name",
      required: true,
    },
  },
  run({ args }) {
    const config = loadConfig();
    attachService(config, args.service);
  },
});

const run = defineCommand({
  meta: {
    name: "run",
    description: "Run a command with services, cleanup on exit",
  },
  args: {
    with: {
      type: "string",
      description: "Comma-separated services to ensure",
      required: true,
    },
    "no-stop": { type: "boolean", description: "Don't stop services on exit" },
    "no-dashboard": {
      type: "boolean",
      description: "Skip auto-launching the dashboard",
    },
  },
  async run({ args }) {
    const config = loadConfig();
    const services = args.with.split(",").map((s: string) => s.trim());
    const command = args._ as string[];

    if (!command || command.length === 0) {
      console.error("❌ No command specified");
      process.exit(1);
    }

    try {
      const exitCode = await runWithServices(config, command, {
        services,
        stopOnExit: !args["no-stop"],
        dashboard: args["no-dashboard"] ? false : undefined,
      });
      process.exit(exitCode);
    } catch (err) {
      if (err instanceof PortConflictError) {
        console.error(`\n⚠️  ${err.message}\n`);
        process.exit(1);
      }
      throw err;
    }
  },
});

const discover = defineCommand({
  meta: { name: "discover", description: "Discover services from turbo.json" },
  args: {
    source: {
      type: "positional",
      description: "Source to discover from (turbo)",
      default: "turbo",
    },
  },
  run({ args }) {
    if (args.source !== "turbo") {
      console.error(`❌ Unknown source: ${args.source}. Supported: turbo`);
      process.exit(1);
    }

    const discovered = discoverFromTurbo(process.cwd());

    if (!discovered) {
      console.error(
        "❌ No services discovered. Make sure turbo.json exists with persistent tasks.",
      );
      process.exit(1);
    }

    console.log(formatDiscoveredConfig(discovered));
    console.log("");
    console.log(
      "Save this as devmux.config.json and update the health checks.",
    );
  },
});

const init = defineCommand({
  meta: {
    name: "init",
    description:
      "Print a starter devmux config to stdout. Pipe to a file to save it.",
  },
  run() {
    const template = {
      version: 1,
      project: "my-project",
      services: {
        api: {
          cwd: ".",
          command: "pnpm dev",
          health: { type: "port", port: 8787 },
        },
      },
    };

    console.log(JSON.stringify(template, null, 2));
    console.error("");
    console.error("Usage:");
    console.error("  devmux init > devmux.config.json              # Save template");
    console.error("  devmux discover > devmux.config.json           # Auto-discover from turbo.json");
    console.error("");
    console.error("Then edit the file to match your project's services.");
  },
});

const diagnose = defineCommand({
  meta: { name: "diagnose", description: "Diagnose port issues for a service" },
  args: {
    service: {
      type: "positional",
      description: "Service name",
      required: true,
    },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const config = loadConfig();
    const { getResolvedPort } = require("./config/loader.js");

    const port = getResolvedPort(config, args.service);

    if (port === undefined) {
      console.error(`❌ No port configured for service: ${args.service}`);
      process.exit(1);
    }

    const result = await diagnosePort(port, args.service);

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(formatDiagnosis(result));
  },
});

const ports = defineCommand({
  meta: {
    name: "ports",
    description: "Show configured ports for the current project",
  },
  args: {
    json: { type: "boolean", description: "Output as JSON" },
    plain: { type: "boolean", description: "Output as tab-separated lines" },
    live: {
      type: "boolean",
      description: "Also probe whether ports are currently occupied",
    },
  },
  async run({ args }) {
    const report = await collectLocalPortReport({ live: args.live });

    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    if (args.plain) {
      for (const service of report.services) {
        const liveStatus = service.live?.summary.isBlocked
          ? "occupied"
          : "free";
        console.log(
          [
            report.project,
            service.serviceName,
            service.basePort ?? "",
            service.resolvedPort ?? "",
            service.healthType,
            args.live ? liveStatus : "",
          ].join("\t"),
        );
      }
      return;
    }

    console.log("═══════════════════════════════════════");
    console.log("        Project Ports");
    console.log("═══════════════════════════════════════");
    console.log("");
    console.log(`Project: ${report.project}`);
    console.log(`Config: ${report.configRoot}`);
    console.log(`Services: ${report.summary.serviceCount}`);
    console.log(`Configured ports: ${report.summary.servicesWithPorts}`);
    if (report.instanceId) {
      console.log(`Instance: ${report.instanceId}`);
    }
    console.log("");

    for (const service of report.services) {
      const portDisplay =
        service.basePort === undefined
          ? "n/a"
          : report.instanceId && service.resolvedPort !== undefined
            ? `${service.basePort} -> ${service.resolvedPort}`
            : `${service.basePort}`;
      const icon = service.basePort === undefined ? "⚫" : "✅";
      console.log(
        `${icon} ${service.serviceName} : ${portDisplay} [${service.healthType}]`,
      );
      if (service.live?.summary.isBlocked) {
        console.log(
          `   └─ live blocker: ${service.live.summary.blockerName ?? "occupied"}`,
        );
      }
      console.log("");
    }
  },
});

const installSkill = defineCommand({
  meta: {
    name: "install-skill",
    description: "Install DevMux skills to .claude/skills",
  },
  run() {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const skillDir = join(__dirname, "skill");
    const targetDir = join(process.cwd(), ".claude", "skills", "devmux");

    try {
      if (!existsSync(skillDir)) {
        throw new Error(`Skill directory not found at ${skillDir}`);
      }

      mkdirSync(targetDir, { recursive: true });
      cpSync(skillDir, targetDir, { recursive: true });

      console.log(`✅ Installed DevMux skill to .claude/skills/devmux/`);
    } catch (e) {
      console.error("❌ Failed to install skills:");
      console.error(e);
      process.exit(1);
    }
  },
});

const watchStart = defineCommand({
  meta: { name: "start", description: "Start watching a service for errors" },
  args: {
    service: { type: "positional", description: "Service name (or 'all')" },
  },
  run({ args }) {
    const config = loadConfig();
    const serviceName = args.service;

    if (!serviceName || serviceName === "all") {
      startAllWatchers(config);
    } else {
      startServiceWatcher(config, serviceName);
    }
  },
});

const watchStop = defineCommand({
  meta: { name: "stop", description: "Stop watching a service" },
  args: {
    service: { type: "positional", description: "Service name (or 'all')" },
  },
  run({ args }) {
    const config = loadConfig();
    const serviceName = args.service;

    if (!serviceName || serviceName === "all") {
      stopAllWatchers(config);
    } else {
      stopServiceWatcher(config, serviceName);
    }
  },
});

const watchStatus = defineCommand({
  meta: { name: "status", description: "Show watcher status" },
  args: {
    json: { type: "boolean", description: "Output as JSON" },
  },
  run({ args }) {
    const config = loadConfig();
    const statuses = getAllWatcherStatuses(config);

    if (args.json) {
      console.log(JSON.stringify(statuses, null, 2));
      return;
    }

    console.log("");
    console.log("═══════════════════════════════════════");
    console.log("        Watcher Status");
    console.log("═══════════════════════════════════════");
    console.log("");

    for (const s of statuses) {
      const icon = s.pipeActive ? "👁️" : "⚫";
      console.log(
        `${icon} ${s.service}: ${s.pipeActive ? "Watching" : "Not watching"}`,
      );
      if (s.pipeActive) {
        console.log(`   └─ session: ${s.sessionName}`);
      }
    }
    console.log("");
  },
});

const watchQueue = defineCommand({
  meta: { name: "queue", description: "Show pending errors in queue" },
  args: {
    json: { type: "boolean", description: "Output as JSON" },
    clear: { type: "boolean", description: "Clear the queue" },
  },
  run({ args }) {
    if (args.clear) {
      clearQueue();
      console.log("✅ Queue cleared");
      return;
    }

    const events = getPendingEvents();

    if (args.json) {
      console.log(JSON.stringify(events, null, 2));
      return;
    }

    if (events.length === 0) {
      console.log("No pending errors in queue.");
      return;
    }

    console.log("");
    console.log(`═══════════════════════════════════════`);
    console.log(`        Pending Errors (${events.length})`);
    console.log(`═══════════════════════════════════════`);
    console.log("");

    for (const e of events) {
      const severityIcon =
        e.severity === "critical"
          ? "🔴"
          : e.severity === "error"
            ? "🟠"
            : e.severity === "warning"
              ? "🟡"
              : "🔵";

      console.log(`${severityIcon} [${e.service}] ${e.pattern}`);
      console.log(
        `   ${e.rawContent.slice(0, 80)}${e.rawContent.length > 80 ? "..." : ""}`,
      );
      console.log(`   └─ ${e.firstSeen}`);
      console.log("");
    }
  },
});

const watch = defineCommand({
  meta: { name: "watch", description: "Manage error watchers for services" },
  subCommands: {
    start: watchStart,
    stop: watchStop,
    status: watchStatus,
    queue: watchQueue,
  },
});

const telemetryStart = defineCommand({
  meta: { name: "start", description: "Start the telemetry server" },
  args: {
    port: { type: "string", description: "Port to listen on (default: 9876)" },
    host: { type: "string", description: "Host to bind to (default: 0.0.0.0)" },
  },
  async run({ args }) {
    const { startServer } = await import("./telemetry/server-manager.js");
    startServer({
      port: args.port ? parseInt(args.port) : undefined,
      host: args.host,
    });
  },
});

const telemetryStop = defineCommand({
  meta: { name: "stop", description: "Stop the telemetry server" },
  async run() {
    const { stopServer } = await import("./telemetry/server-manager.js");
    stopServer();
  },
});

const telemetryStatus = defineCommand({
  meta: { name: "status", description: "Show telemetry server status" },
  args: {
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const { getServerStatus } = await import("./telemetry/server-manager.js");
    const status = getServerStatus();

    if (args.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    if (status.running) {
      console.log(`Telemetry Server: Running (PID: ${status.pid})`);
      console.log(`  Listening on: ws://${status.host}:${status.port}`);
    } else {
      console.log("Telemetry Server: Not running");
      console.log("  Start with: devmux telemetry start");
    }
  },
});

const telemetry = defineCommand({
  meta: {
    name: "telemetry",
    description: "Manage telemetry server for browser/app logs",
  },
  subCommands: {
    start: telemetryStart,
    stop: telemetryStop,
    status: telemetryStatus,
  },
});

const dashboardStart = defineCommand({
  meta: { name: "start", description: "Start the dashboard server" },
  args: {
    port: { type: "string", description: "Port to listen on (default: 9000)" },
    "no-open": {
      type: "boolean",
      description: "Don't open browser automatically",
    },
  },
  async run({ args }) {
    const {
      getDashboardStatus,
      startDashboard,
      saveDashboardPid,
      clearDashboardPid,
    } = await import("./dashboard/index.js");
    const existing = getDashboardStatus();
    if (existing.running) {
      console.log(
        `Dashboard already running (PID: ${existing.pid}, port: ${existing.port})`,
      );
      return;
    }
    const result = await startDashboard({
      port: args.port ? parseInt(args.port) : undefined,
      open: !args["no-open"],
    });
    saveDashboardPid(process.pid, result.port);
    const cleanupDashboard = () => {
      result.server.close();
      clearDashboardPid();
    };
    process.on("SIGINT", () => {
      cleanupDashboard();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      cleanupDashboard();
      process.exit(0);
    });
  },
});

const dashboardStop = defineCommand({
  meta: { name: "stop", description: "Stop the dashboard server" },
  async run() {
    const { stopDashboardServer } = await import("./dashboard/index.js");
    stopDashboardServer();
  },
});

const dashboardStatus = defineCommand({
  meta: { name: "status", description: "Show dashboard server status" },
  args: {
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const { getDashboardStatus } = await import("./dashboard/index.js");
    const status = getDashboardStatus();

    if (args.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    if (status.running) {
      console.log(`Dashboard: Running (PID: ${status.pid})`);
      console.log(`  URL: http://localhost:${status.port}`);
    } else {
      console.log("Dashboard: Not running");
      console.log("  Start with: devmux dashboard start");
    }
  },
});

const dashboard = defineCommand({
  meta: {
    name: "dashboard",
    description: "Manage web dashboard for service monitoring",
  },
  subCommands: {
    start: dashboardStart,
    stop: dashboardStop,
    status: dashboardStatus,
  },
});

function printProxySetupCommands(commands: string[]): void {
  console.log("Run these commands once on the machine hosting devmux:");
  console.log("");
  for (const command of commands) {
    console.log(command);
    console.log("");
  }
}

const proxySetup = defineCommand({
  meta: {
    name: "setup",
    description: "Install the managed Caddy config for portless proxying",
  },
  args: {
    apply: {
      type: "boolean",
      description: "Write the Caddyfile/LaunchDaemon and load it (requires sudo)",
    },
    json: { type: "boolean", description: "Output setup details as JSON" },
    script: {
      type: "boolean",
      description: "Write a reusable shell script next to the repo root",
    },
  },
  async run({ args }) {
    const report = proxySystem.getProxyDoctorReport(await caddy.isAvailable());

    if (!report.supported) {
      console.error("Managed proxy setup is currently supported on macOS only.");
      process.exit(1);
    }

    if (!report.caddyBinaryPath || !report.caddyBinaryExists) {
      console.error("❌ Caddy is not installed.");
      console.error("   Install it with: brew install caddy");
      process.exit(1);
    }

    const commands = proxySystem.buildProxySetupCommands(report.caddyBinaryPath);

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            ...report,
            commands,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (args.script) {
      const scriptPath = join(process.cwd(), "devmux-proxy-setup.sh");
      const script = `#!/usr/bin/env bash\nset -euo pipefail\n\n${commands.join("\n\n")}\n`;
      mkdirSync(dirname(scriptPath), { recursive: true });
      writeFileSync(scriptPath, script, "utf8");
      chmodSync(scriptPath, 0o755);
      console.log(`✅ Wrote ${scriptPath}`);
      console.log(`   Run it with: sudo "${scriptPath}"`);
      if (!args.apply) return;
    }

    if (args.apply) {
      if (typeof process.getuid !== "function" || process.getuid() !== 0) {
        console.error("❌ --apply must be run as root.");
        console.error("   Run: sudo devmux proxy setup --apply");
        process.exit(1);
      }

      proxySystem.writeManagedProxyFiles(report.caddyBinaryPath);

      await execa("launchctl", ["unload", "-w", proxySystem.DEFAULT_LAUNCHD_PLIST_PATH], {
        reject: false,
        stdout: "ignore",
        stderr: "ignore",
      });
      const result = await execa(
        "launchctl",
        ["load", "-w", proxySystem.DEFAULT_LAUNCHD_PLIST_PATH],
        {
          reject: false,
          stdout: "inherit",
          stderr: "inherit",
        },
      );
      if (result.exitCode !== 0) {
        console.error("❌ Failed to load LaunchDaemon.");
        process.exit(result.exitCode ?? 1);
      }

      console.log(`✅ Installed managed proxy (${proxySystem.DEVMUX_CADDY_LABEL})`);
      console.log(`   └─ Caddyfile: ${report.caddyfilePath}`);
      console.log(`   └─ LaunchDaemon: ${report.launchdPlistPath}`);
      return;
    }

    console.log("Managed proxy setup is available.");
    console.log("Run `sudo devmux proxy setup --apply` to install it automatically.");
    console.log("");
    printProxySetupCommands(commands);
  },
});

const proxyDoctor = defineCommand({
  meta: { name: "doctor", description: "Diagnose managed proxy readiness" },
  args: {
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const report = proxySystem.getProxyDoctorReport(await caddy.isAvailable());
    const lines = proxySystem.formatProxyDoctorReport(report);

    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log("Proxy Doctor");
    console.log("════════════");
    for (const line of lines) {
      console.log(line);
    }
  },
});

const proxyRoutes = defineCommand({
  meta: { name: "routes", description: "List active proxy routes" },
  async run() {
    const config = loadConfig();
    if (!(await caddy.isAvailable())) {
      console.error("Proxy is not running.");
      console.error("Run `devmux proxy doctor` for setup help.");
      process.exit(1);
    }
    await listProxyRoutes(config);
  },
});

const proxyStart = defineCommand({
  meta: { name: "start", description: "Start the portless proxy server" },
  async run() {
    if (await caddy.isAvailable()) {
      console.log("Proxy: Running");
      return;
    }
    console.log("Caddy is the proxy.");
    console.log("If this machine is not configured yet, run:");
    console.log("  sudo devmux proxy setup --apply");
    console.log("");
    console.log("If it is already installed, start it with:");
    console.log(`  sudo launchctl kickstart -k system/${proxySystem.DEVMUX_CADDY_LABEL}`);
  },
});

const proxyStop = defineCommand({
  meta: { name: "stop", description: "Stop the portless proxy server" },
  run() {
    console.log("Caddy is the proxy. To stop it:");
    console.log(`  sudo launchctl bootout system/${proxySystem.DEVMUX_CADDY_LABEL}`);
  },
});

const proxyStatus = defineCommand({
  meta: { name: "status", description: "Show proxy status and routes" },
  args: {
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const config = loadConfig();
    const available = await caddy.isAvailable();
    const report = proxySystem.getProxyDoctorReport(available);

    if (args.json) {
      console.log(JSON.stringify({ available, report }, null, 2));
      return;
    }

    if (available) {
      console.log("Proxy: Running");
      await listProxyRoutes(config);
    } else {
      console.log("Proxy: Not running");
      for (const line of proxySystem.formatProxyDoctorReport(report)) {
        console.log(`  ${line}`);
      }
    }
  },
});

const proxy = defineCommand({
  meta: {
    name: "proxy",
    description: "Manage portless proxy for .localhost URLs",
  },
  subCommands: {
    setup: proxySetup,
    doctor: proxyDoctor,
    start: proxyStart,
    stop: proxyStop,
    status: proxyStatus,
    routes: proxyRoutes,
  },
});

const main = defineCommand({
  meta: {
    name: "devmux",
    version,
    description: "tmux-based service management for monorepos",
  },
  subCommands: {
    ensure,
    start,
    restart,
    status,
    stop,
    attach,
    run,
    discover,
    init,
    diagnose,
    ports,
    watch,
    telemetry,
    dashboard,
    proxy,
    "install-skill": installSkill,
  },
});

runMain(main);
