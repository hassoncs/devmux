import { spawn } from "node:child_process";
import type { Server } from "node:http";
import type { ResolvedConfig } from "../config/types.js";
import { getSessionName } from "../config/loader.js";
import { ensureService, stopService, type EnsureResult } from "./service.js";
import { checkHealth } from "../health/checkers.js";
import { saveDashboardPid, clearDashboardPid } from "../dashboard/server-manager.js";

export interface RunOptions {
  services: string[];
  stopOnExit?: boolean;
  quiet?: boolean;
  dashboard?: boolean;
}

function resolveDashboardConfig(config: ResolvedConfig, override?: boolean): { enabled: boolean; port: number } {
  if (override === false) return { enabled: false, port: 9000 };

  const opt = config.defaults?.dashboard;
  if (override === true || opt === true) return { enabled: true, port: 9000 };
  if (opt && typeof opt === "object") return { enabled: true, port: opt.port ?? 9000 };

  return { enabled: false, port: 9000 };
}

export async function runWithServices(
  config: ResolvedConfig,
  command: string[],
  options: RunOptions
): Promise<number> {
  const { services, stopOnExit = true, quiet = false } = options;
  const log = quiet ? () => {} : console.log;

  const startedByUs: EnsureResult[] = [];
  let dashboardServer: Server | undefined;
  let dashboardTracked = false;

  for (const serviceName of services) {
    const service = config.services[serviceName];
    if (!service) {
      console.error(`❌ Unknown service: ${serviceName}`);
      process.exit(1);
    }

    const sessionName = getSessionName(config, serviceName);
    const wasHealthy = await checkHealth(service.health, sessionName);

    if (wasHealthy) {
      log(`✅ ${serviceName} already running (will keep on exit)`);
    } else {
      const result = await ensureService(config, serviceName, { quiet });
      if (result.startedByUs) {
        startedByUs.push(result);
        log(`   (will stop on Ctrl+C)`);
      }
    }
  }

  const dashboardConfig = resolveDashboardConfig(config, options.dashboard);
  if (dashboardConfig.enabled) {
    try {
      const { startDashboard } = await import("../dashboard/index.js");
      const result = await startDashboard({ port: dashboardConfig.port, open: true });
      dashboardServer = result.server;
      saveDashboardPid(process.pid, result.port);
      dashboardTracked = true;
    } catch (err) {
      log(`⚠️  Dashboard failed to start: ${err instanceof Error ? err.message : err}`);
    }
  }

  log("");

  const cleanup = () => {
    if (dashboardServer) {
      dashboardServer.close();
      dashboardServer = undefined;
    }
    if (dashboardTracked) {
      clearDashboardPid();
      dashboardTracked = false;
    }

    if (stopOnExit && startedByUs.length > 0) {
      log("");
      log("🧹 Cleaning up services we started...");
      for (const result of startedByUs) {
        stopService(config, result.serviceName, { killPorts: true, quiet: true });
        log(`   └─ Stopped ${result.serviceName}`);
      }
    }
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });

  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });

  process.on("exit", cleanup);

  const [cmd, ...args] = command;
  const child = spawn(cmd, args, {
    stdio: "inherit",
    shell: true,
  });

  return new Promise((resolve) => {
    child.on("close", (code) => {
      resolve(code ?? 0);
    });

    child.on("error", (err) => {
      console.error(`Failed to run command: ${err.message}`);
      resolve(1);
    });
  });
}
