import { execSync } from "node:child_process";
import { resolve } from "node:path";
import type { ResolvedConfig, ServiceStatus, HealthCheckType, PortConflictInfo } from "../config/types.js";
import { getSessionName, getServiceCwd, getResolvedPort } from "../config/loader.js";
import * as tmux from "../tmux/driver.js";
import { checkHealth, getHealthPort } from "../health/checkers.js";
import { getProcessesOnPort, getProcessOnPort, killProcess, getProcessCwd } from "../utils/process.js";
import {
  isServiceProxied,
  getServiceProxyUrl,
  registerRoute,
  deregisterRoute,
  ensureProxyRunning,
  findFreePort,
} from "../proxy/manager.js";

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
  const proxied = isServiceProxied(config, serviceName);

  let resolvedPort = getResolvedPort(config, serviceName);
  if (resolvedPort === undefined && proxied) {
    resolvedPort = await findFreePort();
  }

  const resolvedHealth = resolveHealthCheck(service.health, resolvedPort);
  const autoHealth = resolvedPort && !service.health
    ? { type: "port" as const, port: resolvedPort }
    : resolvedHealth;
  const env = buildServiceEnv(config, serviceName, service.env, resolvedPort);

  if (proxied) {
    await ensureProxyRunning(config);
  }

  const isHealthy = await checkHealth(autoHealth, sessionName);
  if (isHealthy) {
    const hasTmux = tmux.hasSession(sessionName);

    if (!hasTmux && resolvedPort) {
      const conflict = await detectPortConflict(resolvedPort, config.configRoot, serviceName);
      if (conflict) {
        const msg = formatPortConflictError(conflict, serviceName, resolvedPort);
        throw new PortConflictError(msg, conflict);
      }
    }

    log(`✅ ${serviceName} already running`);
    if (hasTmux) {
      log(`   └─ tmux session: ${sessionName}`);
    } else {
      log(`   └─ (running outside tmux)`);
    }
    if (resolvedPort && config.instanceId) {
      log(`   └─ port: ${resolvedPort} (instance: ${config.instanceId})`);
    }
    if (proxied && resolvedPort) {
      const panePid = getPanePid(sessionName);
      registerRoute(config, serviceName, resolvedPort, panePid ?? process.pid);
      log(`   └─ ${getServiceProxyUrl(config, serviceName)}`);
    }
    return { serviceName, startedByUs: false, sessionName };
  }

  if (tmux.hasSession(sessionName)) {
    log(`🔄 Cleaning up stale session: ${sessionName}`);
    tmux.killSession(sessionName);
  }

  log(`🚀 Starting ${serviceName} in tmux session: ${sessionName}`);
  if (resolvedPort && config.instanceId) {
    log(`   └─ port: ${resolvedPort} (instance: ${config.instanceId})`);
  }
  const resolvedCommand = service.command
    .replace(/\{\{PORT\}\}/g, String(resolvedPort ?? ""))
    .replace(/\{\{INSTANCE\}\}/g, config.instanceId)
    .replace(/\{\{SERVICE\}\}/g, serviceName)
    .replace(/\{\{PROJECT\}\}/g, config.project);
  tmux.newSession(sessionName, cwd, resolvedCommand, env);

  const remainOnExit = config.defaults?.remainOnExit ?? true;
  tmux.setRemainOnExit(sessionName, remainOnExit);

  log(`⏳ Waiting for ${serviceName} to be ready...`);
  for (let i = 0; i < timeout; i++) {
    if (await checkHealth(autoHealth, sessionName)) {
      log(`✅ ${serviceName} ready`);
      log(`   └─ tmux session: ${sessionName}`);
      if (proxied && resolvedPort) {
        const panePid = getPanePid(sessionName);
        registerRoute(config, serviceName, resolvedPort, panePid ?? process.pid);
        log(`   └─ ${getServiceProxyUrl(config, serviceName)}`);
      }
      return { serviceName, startedByUs: true, sessionName };
    }
    await sleep(1000);
  }

  throw new Error(`${serviceName} failed to start within ${timeout}s`);
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
  const healthy = await checkHealth(resolvedHealth, sessionName);
  const hasTmux = tmux.hasSession(sessionName);

  const proxied = isServiceProxied(config, serviceName);

  let portConflict: PortConflictInfo | undefined;
  if (healthy && !hasTmux && resolvedPort) {
    const conflict = await detectPortConflict(resolvedPort, config.configRoot, serviceName);
    if (conflict) {
      portConflict = conflict;
    }
  }

  return {
    name: serviceName,
    healthy,
    tmuxSession: hasTmux ? sessionName : null,
    port: getHealthPort(service.health),
    resolvedPort,
    managedByDevmux: hasTmux,
    instanceId: config.instanceId || undefined,
    proxyUrl: proxied && resolvedPort ? getServiceProxyUrl(config, serviceName) : undefined,
    portConflict,
  };
}

export async function getAllStatus(config: ResolvedConfig): Promise<ServiceStatus[]> {
  const statuses: ServiceStatus[] = [];
  for (const serviceName of Object.keys(config.services)) {
    statuses.push(await getStatus(config, serviceName));
  }
  return statuses;
}

export async function stopService(
  config: ResolvedConfig,
  serviceName: string,
  options: { killPorts?: boolean; quiet?: boolean } = {}
): Promise<void> {
  const service = config.services[serviceName];
  if (!service) {
    throw new Error(`Unknown service: ${serviceName}`);
  }

  const sessionName = getSessionName(config, serviceName);
  const log = options.quiet ? () => {} : console.log;

  log(`🛑 Stopping ${serviceName}...`);

  if (isServiceProxied(config, serviceName)) {
    try {
      deregisterRoute(config, serviceName);
    } catch {}
  }

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
      const processes = await getProcessesOnPort(port);
      for (const proc of processes) {
        await killProcess(proc.pid);
        log(`   └─ Killed process ${proc.name} (PID ${proc.pid}) on port ${port}`);
      }
    }
  }

  log(`✅ ${serviceName} stopped`);
}

export async function stopAllServices(
  config: ResolvedConfig,
  options: { killPorts?: boolean; quiet?: boolean } = {}
): Promise<void> {
  for (const serviceName of Object.keys(config.services)) {
    await stopService(config, serviceName, options);
  }
}

export async function restartService(
  config: ResolvedConfig,
  serviceName: string,
  options: { timeout?: number; killPorts?: boolean; quiet?: boolean } = {}
): Promise<EnsureResult> {
  stopService(config, serviceName, { killPorts: options.killPorts, quiet: options.quiet });
  return ensureService(config, serviceName, { timeout: options.timeout, quiet: options.quiet });
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

function getPanePid(sessionName: string): number | null {
  try {
    const output = execSync(
      `tmux list-panes -t "${sessionName}" -F "#{pane_pid}"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const pid = parseInt(output.trim().split("\n")[0], 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function resolveHealthCheck(health: HealthCheckType | undefined, resolvedPort: number | undefined): HealthCheckType | undefined {
  if (!health) return undefined;
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

export class PortConflictError extends Error {
  conflict: PortConflictInfo;
  constructor(message: string, conflict: PortConflictInfo) {
    super(message);
    this.name = "PortConflictError";
    this.conflict = conflict;
  }
}

async function detectPortConflict(
  port: number,
  configRoot: string,
  serviceName: string,
): Promise<PortConflictInfo | null> {
  const proc = await getProcessOnPort(port);
  if (!proc) return null;

  const processCwd = proc.cwd ?? getProcessCwd(proc.pid);
  if (!processCwd) {
    return {
      port,
      serviceName,
      pid: proc.pid,
      processName: proc.name,
      processCmd: proc.cmd,
      processCwd: null,
      expectedCwd: configRoot,
      cwdMatch: "unknown",
    };
  }

  const normalizedProcessCwd = resolve(processCwd);
  const normalizedConfigRoot = resolve(configRoot);
  const isMatch =
    normalizedProcessCwd === normalizedConfigRoot ||
    normalizedProcessCwd.startsWith(normalizedConfigRoot + "/");

  if (isMatch) return null;

  return {
    port,
    serviceName,
    pid: proc.pid,
    processName: proc.name,
    processCmd: proc.cmd,
    processCwd: normalizedProcessCwd,
    expectedCwd: normalizedConfigRoot,
    cwdMatch: "mismatch",
  };
}

function formatPortConflictError(
  conflict: PortConflictInfo,
  serviceName: string,
  port: number,
): string {
  const lines: string[] = [];
  lines.push(`Port conflict detected for ${serviceName} (port ${port})`);
  lines.push(`Port ${port} is in use by another process:`);
  lines.push(`  PID ${conflict.pid}: ${conflict.processName}`);
  if (conflict.processCmd) {
    lines.push(`  Command: ${conflict.processCmd}`);
  }
  if (conflict.processCwd) {
    lines.push(`  Working dir: ${conflict.processCwd}`);
    lines.push(`  Expected:    ${conflict.expectedCwd}`);
  } else {
    lines.push(`  Working dir: unknown`);
    lines.push(`  Expected:    ${conflict.expectedCwd}`);
  }
  lines.push(`This is NOT the ${serviceName} service.`);
  lines.push(`Run \`kill ${conflict.pid}\` to free the port, then retry.`);
  return lines.join("\n");
}

function buildServiceEnv(
  config: ResolvedConfig,
  serviceName: string,
  userEnv?: Record<string, string>,
  portOverride?: number,
): Record<string, string> {
  const resolvedPort = portOverride ?? getResolvedPort(config, serviceName);
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
