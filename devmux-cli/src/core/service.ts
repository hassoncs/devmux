import { execSync } from "node:child_process";
import type { ResolvedConfig, ServiceStatus, HealthCheckType } from "../config/types.js";
import { getSessionName, getServiceCwd, getResolvedPort } from "../config/loader.js";
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
  options: { timeout?: number; quiet?: boolean } = {},
  _dependencyStack: Set<string> = new Set()
): Promise<EnsureResult> {
  if (_dependencyStack.has(serviceName)) {
    throw new Error(`Circular dependency detected: ${Array.from(_dependencyStack).join(' -> ')} -> ${serviceName}`);
  }

  const service = config.services[serviceName];
  if (!service) {
    throw new Error(`Unknown service: ${serviceName}`);
  }

  if (service.dependsOn && service.dependsOn.length > 0) {
    _dependencyStack.add(serviceName);
    try {
      if (!options.quiet) console.log(`Checking dependencies for ${serviceName}...`);
      for (const dep of service.dependsOn) {
        await ensureService(config, dep, options, _dependencyStack);
      }
    } finally {
      _dependencyStack.delete(serviceName);
    }
  }

  const sessionName = getSessionName(config, serviceName);
  const cwd = getServiceCwd(config, serviceName);
  const timeout = options.timeout ?? config.defaults?.startupTimeoutSeconds ?? 30;
  const log = options.quiet ? () => {} : console.log;
  
  const resolvedPort = getResolvedPort(config, serviceName);
  const resolvedHealth = resolveHealthCheck(service.health, resolvedPort);
  const env = buildServiceEnv(config, serviceName, service.env);

  const isHealthy = await checkHealth(resolvedHealth);
  if (isHealthy) {
    const hasTmux = tmux.hasSession(sessionName);
    log(`✅ ${serviceName} already running`);
    if (hasTmux) {
      log(`   └─ tmux session: ${sessionName}`);
    } else {
      log(`   └─ (running outside tmux)`);
    }
    if (resolvedPort && config.instanceId) {
      log(`   └─ port: ${resolvedPort} (instance: ${config.instanceId})`);
    }
    return { serviceName, startedByUs: false, sessionName };
  }

  if (!acquireLock(sessionName)) {
    log(`⏳ Another process is starting ${serviceName}, waiting...`);
    for (let i = 0; i < 10; i++) {
      await sleep(1000);
      if (await checkHealth(resolvedHealth)) {
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
    if (resolvedPort && config.instanceId) {
      log(`   └─ port: ${resolvedPort} (instance: ${config.instanceId})`);
    }
    tmux.newSession(sessionName, cwd, service.command, env);

    const remainOnExit = config.defaults?.remainOnExit ?? true;
    tmux.setRemainOnExit(sessionName, remainOnExit);

    log(`⏳ Waiting for ${serviceName} to be ready...`);
    for (let i = 0; i < timeout; i++) {
      if (await checkHealth(resolvedHealth)) {
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
  const resolvedPort = getResolvedPort(config, serviceName);
  const resolvedHealth = resolveHealthCheck(service.health, resolvedPort);
  const healthy = await checkHealth(resolvedHealth);
  const hasTmux = tmux.hasSession(sessionName);

  return {
    name: serviceName,
    healthy,
    tmuxSession: hasTmux ? sessionName : null,
    port: getHealthPort(service.health),
    resolvedPort,
    managedByDevmux: hasTmux,
    instanceId: config.instanceId || undefined,
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
    const resolvedPort = getResolvedPort(config, serviceName);
    const ports: number[] = [];
    
    if (resolvedPort) ports.push(resolvedPort);
    if (service.stopPorts) {
      for (const p of service.stopPorts) {
        ports.push(p);
      }
    }

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

function resolveHealthCheck(health: HealthCheckType, resolvedPort: number | undefined): HealthCheckType {
  if (resolvedPort === undefined) return health;
  
  if (health.type === "port") {
    return { ...health, port: resolvedPort };
  }
  if (health.type === "http") {
    try {
      const url = new URL(health.url);
      url.port = String(resolvedPort);
      return { ...health, url: url.toString() };
    } catch {
      return health;
    }
  }
  return health;
}

function buildServiceEnv(
  config: ResolvedConfig,
  serviceName: string,
  userEnv?: Record<string, string>
): Record<string, string> {
  const resolvedPort = getResolvedPort(config, serviceName);
  const env: Record<string, string> = {};
  
  if (resolvedPort !== undefined) {
    env.PORT = String(resolvedPort);
    env.DEVMUX_PORT = String(resolvedPort);
  }
  
  if (config.instanceId) {
    env.DEVMUX_INSTANCE_ID = config.instanceId;
  }
  
  env.DEVMUX_SERVICE = serviceName;
  env.DEVMUX_PROJECT = config.project;
  
  if (userEnv) {
    for (const [key, value] of Object.entries(userEnv)) {
      env[key] = value
        .replace(/\{\{PORT\}\}/g, String(resolvedPort ?? ""))
        .replace(/\{\{INSTANCE\}\}/g, config.instanceId)
        .replace(/\{\{SERVICE\}\}/g, serviceName)
        .replace(/\{\{PROJECT\}\}/g, config.project);
    }
  }
  
  return env;
}
