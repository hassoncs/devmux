import { execSync } from "node:child_process";
import type { ResolvedConfig, ServiceStatus } from "../config/types.js";
import { getSessionName, getServiceCwd } from "../config/loader.js";
import * as tmux from "../tmux/driver.js";
import { checkHealth, getHealthPort } from "../health/checkers.js";
import { acquireLock, releaseLock } from "../utils/lock.js";

export interface EnsureResult {
  serviceName: string;
  startedByUs: boolean;
  sessionName: string;
}

export async function ensureService(
  config: ResolvedConfig,
  serviceName: string,
  options: { timeout?: number; quiet?: boolean } = {}
): Promise<EnsureResult> {
  const service = config.services[serviceName];
  if (!service) {
    throw new Error(`Unknown service: ${serviceName}`);
  }

  const sessionName = getSessionName(config, serviceName);
  const cwd = getServiceCwd(config, serviceName);
  const timeout = options.timeout ?? config.defaults?.startupTimeoutSeconds ?? 30;
  const log = options.quiet ? () => {} : console.log;

  const isHealthy = await checkHealth(service.health);
  if (isHealthy) {
    const hasTmux = tmux.hasSession(sessionName);
    log(`✅ ${serviceName} already running`);
    if (hasTmux) {
      log(`   └─ tmux session: ${sessionName}`);
    } else {
      log(`   └─ (running outside tmux)`);
    }
    return { serviceName, startedByUs: false, sessionName };
  }

  if (!acquireLock(sessionName)) {
    log(`⏳ Another process is starting ${serviceName}, waiting...`);
    for (let i = 0; i < 10; i++) {
      await sleep(1000);
      if (await checkHealth(service.health)) {
        log(`✅ ${serviceName} now running`);
        return { serviceName, startedByUs: false, sessionName };
      }
    }
    throw new Error(`${serviceName} failed to start (locked by another process)`);
  }

  try {
    if (tmux.hasSession(sessionName)) {
      log(`🔄 Cleaning up stale session: ${sessionName}`);
      tmux.killSession(sessionName);
    }

    log(`🚀 Starting ${serviceName} in tmux session: ${sessionName}`);
    tmux.newSession(sessionName, cwd, service.command, service.env);

    const remainOnExit = config.defaults?.remainOnExit ?? true;
    tmux.setRemainOnExit(sessionName, remainOnExit);

    log(`⏳ Waiting for ${serviceName} to be ready...`);
    for (let i = 0; i < timeout; i++) {
      if (await checkHealth(service.health)) {
        log(`✅ ${serviceName} ready`);
        log(`   └─ tmux session: ${sessionName}`);
        return { serviceName, startedByUs: true, sessionName };
      }
      await sleep(1000);
    }

    throw new Error(`${serviceName} failed to start within ${timeout}s`);
  } finally {
    releaseLock(sessionName);
  }
}

export async function getStatus(
  config: ResolvedConfig,
  serviceName: string
): Promise<ServiceStatus> {
  const service = config.services[serviceName];
  if (!service) {
    throw new Error(`Unknown service: ${serviceName}`);
  }

  const sessionName = getSessionName(config, serviceName);
  const healthy = await checkHealth(service.health);
  const hasTmux = tmux.hasSession(sessionName);

  return {
    name: serviceName,
    healthy,
    tmuxSession: hasTmux ? sessionName : null,
    port: getHealthPort(service.health),
    managedByDevmux: hasTmux,
  };
}

export async function getAllStatus(config: ResolvedConfig): Promise<ServiceStatus[]> {
  const statuses: ServiceStatus[] = [];
  for (const serviceName of Object.keys(config.services)) {
    statuses.push(await getStatus(config, serviceName));
  }
  return statuses;
}

export function stopService(
  config: ResolvedConfig,
  serviceName: string,
  options: { killPorts?: boolean; quiet?: boolean } = {}
): void {
  const service = config.services[serviceName];
  if (!service) {
    throw new Error(`Unknown service: ${serviceName}`);
  }

  const sessionName = getSessionName(config, serviceName);
  const log = options.quiet ? () => {} : console.log;

  log(`🛑 Stopping ${serviceName}...`);

  if (tmux.hasSession(sessionName)) {
    tmux.killSession(sessionName);
    log(`   └─ Killed tmux session: ${sessionName}`);
  }

  if (options.killPorts) {
    const ports = service.stopPorts ?? [];
    const healthPort = getHealthPort(service.health);
    if (healthPort) ports.push(healthPort);

    for (const port of [...new Set(ports)]) {
      try {
        const pids = execSync(`lsof -ti :${port}`, { encoding: "utf-8" }).trim();
        if (pids) {
          execSync(`kill -9 ${pids.split("\n").join(" ")}`, { stdio: "pipe" });
          log(`   └─ Killed process(es) on port ${port}`);
        }
      } catch {}
    }
  }

  log(`✅ ${serviceName} stopped`);
}

export function stopAllServices(
  config: ResolvedConfig,
  options: { killPorts?: boolean; quiet?: boolean } = {}
): void {
  for (const serviceName of Object.keys(config.services)) {
    stopService(config, serviceName, options);
  }
}

export function attachService(config: ResolvedConfig, serviceName: string): void {
  const service = config.services[serviceName];
  if (!service) {
    throw new Error(`Unknown service: ${serviceName}`);
  }

  const sessionName = getSessionName(config, serviceName);

  if (!tmux.hasSession(sessionName)) {
    throw new Error(`No tmux session for ${serviceName}. Service may not be running or was started outside tmux.`);
  }

  console.log(`📎 Attaching to ${sessionName}...`);
  console.log(`   (detach with Ctrl+B, then D)`);
  tmux.attachSession(sessionName);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
