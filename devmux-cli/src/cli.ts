#!/usr/bin/env node

import { defineCommand, runMain } from "citty";
import { readFileSync, mkdirSync, copyFileSync, existsSync, readdirSync, cpSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config/loader.js";
import {
  ensureService,
  restartService,
  getAllStatus,
  stopService,
  stopAllServices,
  attachService,
} from "./core/service.js";
import { runWithServices } from "./core/run.js";
import { discoverFromTurbo, formatDiscoveredConfig } from "./discovery/turbo.js";
import {
  getWatcherStatus,
  getAllWatcherStatuses,
  startServiceWatcher,
  stopServiceWatcher,
  startAllWatchers,
  stopAllWatchers,
  getPendingEvents,
  clearQueue,
} from "./watch/index.js";

const ensure = defineCommand({
  meta: { name: "ensure", description: "Ensure a service is running (idempotent)" },
  args: {
    service: { type: "positional", description: "Service name", required: true },
    timeout: { type: "string", description: "Startup timeout in seconds" },
  },
  async run({ args }) {
    const config = loadConfig();
    await ensureService(config, args.service, {
      timeout: args.timeout ? parseInt(args.timeout) : undefined,
    });
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

    if (args.json) {
      console.log(JSON.stringify({ instanceId: config.instanceId || null, services: statuses }, null, 2));
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
      const icon = s.healthy ? "✅" : "❌";
      const portDisplay = s.resolvedPort ?? s.port;
      const portInfo = portDisplay ? ` (port ${portDisplay})` : "";
      console.log(`${icon} ${s.name}${portInfo}: ${s.healthy ? "Running" : "Not running"}`);

      if (s.tmuxSession) {
        console.log(`   └─ tmux: ${s.tmuxSession}`);
      } else if (s.healthy) {
        console.log(`   └─ (running outside tmux)`);
      }
      console.log("");
    }
  },
});

const stop = defineCommand({
  meta: { name: "stop", description: "Stop a service or all services" },
  args: {
    service: { type: "positional", description: "Service name or 'all'" },
    force: { type: "boolean", description: "Also kill processes on ports" },
  },
  run({ args }) {
    const config = loadConfig();
    const serviceName = args.service ?? "all";

    if (serviceName === "all") {
      stopAllServices(config, { killPorts: args.force });
    } else {
      stopService(config, serviceName, { killPorts: args.force });
    }
  },
});

const restart = defineCommand({
  meta: { name: "restart", description: "Restart a service (stop + start)" },
  args: {
    service: { type: "positional", description: "Service name", required: true },
    timeout: { type: "string", description: "Startup timeout in seconds" },
    force: { type: "boolean", description: "Also kill processes on ports before restarting" },
  },
  async run({ args }) {
    const config = loadConfig();
    await restartService(config, args.service, {
      timeout: args.timeout ? parseInt(args.timeout) : undefined,
      killPorts: args.force,
    });
  },
});

const start = defineCommand({
  meta: { name: "start", description: "Start a service (alias for ensure)" },
  args: {
    service: { type: "positional", description: "Service name", required: true },
    timeout: { type: "string", description: "Startup timeout in seconds" },
  },
  async run({ args }) {
    const config = loadConfig();
    await ensureService(config, args.service, {
      timeout: args.timeout ? parseInt(args.timeout) : undefined,
    });
  },
});

const attach = defineCommand({
  meta: { name: "attach", description: "Attach to a service's tmux session" },
  args: {
    service: { type: "positional", description: "Service name", required: true },
  },
  run({ args }) {
    const config = loadConfig();
    attachService(config, args.service);
  },
});

const run = defineCommand({
  meta: { name: "run", description: "Run a command with services, cleanup on exit" },
  args: {
    with: { type: "string", description: "Comma-separated services to ensure", required: true },
    "no-stop": { type: "boolean", description: "Don't stop services on exit" },
  },
  async run({ args }) {
    const config = loadConfig();
    const services = args.with.split(",").map((s: string) => s.trim());
    const command = args._ as string[];

    if (!command || command.length === 0) {
      console.error("❌ No command specified");
      process.exit(1);
    }

    const exitCode = await runWithServices(config, command, {
      services,
      stopOnExit: !args["no-stop"],
    });

    process.exit(exitCode);
  },
});

const discover = defineCommand({
  meta: { name: "discover", description: "Discover services from turbo.json" },
  args: {
    source: { type: "positional", description: "Source to discover from (turbo)", default: "turbo" },
  },
  run({ args }) {
    if (args.source !== "turbo") {
      console.error(`❌ Unknown source: ${args.source}. Supported: turbo`);
      process.exit(1);
    }

    const discovered = discoverFromTurbo(process.cwd());

    if (!discovered) {
      console.error("❌ No services discovered. Make sure turbo.json exists with persistent tasks.");
      process.exit(1);
    }

    console.log(formatDiscoveredConfig(discovered));
    console.log("");
    console.log("Save this as devmux.config.json and update the health checks.");
  },
});

const init = defineCommand({
  meta: { name: "init", description: "Initialize devmux config" },
  run() {
    const template = {
      version: 1,
      project: "my-project",
      services: {
        api: {
          cwd: "api",
          command: "pnpm dev",
          health: { type: "port", port: 8787 },
        },
      },
    };

    console.log("# devmux.config.json template");
    console.log(JSON.stringify(template, null, 2));
    console.log("");
    console.log("Save this as devmux.config.json in your project root.");
  },
});

const installSkill = defineCommand({
  meta: { name: "install-skill", description: "Install DevMux skills to .claude/skills" },
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
      console.log(`${icon} ${s.service}: ${s.pipeActive ? "Watching" : "Not watching"}`);
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
        e.severity === "critical" ? "🔴" :
        e.severity === "error" ? "🟠" :
        e.severity === "warning" ? "🟡" : "🔵";

      console.log(`${severityIcon} [${e.service}] ${e.pattern}`);
      console.log(`   ${e.rawContent.slice(0, 80)}${e.rawContent.length > 80 ? "..." : ""}`);
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
  meta: { name: "telemetry", description: "Manage telemetry server for browser/app logs" },
  subCommands: {
    start: telemetryStart,
    stop: telemetryStop,
    status: telemetryStatus,
  },
});

const main = defineCommand({
  meta: {
    name: "devmux",
    version: "0.1.0",
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
    watch,
    telemetry,
    "install-skill": installSkill,
  },
});

runMain(main);
