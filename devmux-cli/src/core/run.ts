import { spawn } from "node:child_process";
import type { ResolvedConfig } from "../config/types.js";
import { ensureService, stopService, type EnsureResult } from "./service.js";
import { checkHealth } from "../health/checkers.js";

export interface RunOptions {
  services: string[];
  stopOnExit?: boolean;
  quiet?: boolean;
}

export async function runWithServices(
  config: ResolvedConfig,
  command: string[],
  options: RunOptions
): Promise<number> {
  const { services, stopOnExit = true, quiet = false } = options;
  const log = quiet ? () => {} : console.log;

  const startedByUs: EnsureResult[] = [];

  for (const serviceName of services) {
    const service = config.services[serviceName];
    if (!service) {
      console.error(`❌ Unknown service: ${serviceName}`);
      process.exit(1);
    }

    const wasHealthy = await checkHealth(service.health);

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

  log("");

  const cleanup = () => {
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
