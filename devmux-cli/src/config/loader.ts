import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { resolvePort } from "../utils/port.js";
import { resolveInstanceId } from "../utils/worktree.js";
import type { DevMuxConfig, HealthCheckType, ResolvedConfig } from "./types.js";

export const CONFIG_NAMES = [
  "devmux.config.json",
  ".devmuxrc.json",
  ".devmuxrc",
];

function findConfigFile(startDir: string): string | null {
  let dir = resolve(startDir);
  const root = dirname(dir);

  while (dir !== root) {
    for (const name of CONFIG_NAMES) {
      const configPath = resolve(dir, name);
      if (existsSync(configPath)) {
        return configPath;
      }
    }

    const pkgPath = resolve(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.devmux) {
          return pkgPath;
        }
      } catch {}
    }

    dir = dirname(dir);
  }

  return null;
}

function loadConfigFromFile(configPath: string): DevMuxConfig {
  const content = readFileSync(configPath, "utf-8");

  if (configPath.endsWith("package.json")) {
    const pkg = JSON.parse(content);
    if (!pkg.devmux) {
      throw new Error(`No devmux config found in ${configPath}`);
    }
    return pkg.devmux as DevMuxConfig;
  }

  return JSON.parse(content) as DevMuxConfig;
}

function resolveLoadedConfig(
  config: DevMuxConfig,
  configPath: string,
  instanceId: string = resolveInstanceId(),
): ResolvedConfig {
  if (!validateConfig(config)) {
    throw new Error(`Invalid devmux config in ${configPath}`);
  }

  validateProxyHostnamePattern(config.proxy?.hostnamePattern, configPath);

  const configRoot = dirname(configPath);
  const resolvedSessionPrefix = config.sessionPrefix ?? `omo-${config.project}`;

  return {
    ...config,
    configRoot,
    resolvedSessionPrefix,
    instanceId,
  };
}

function validateConfig(config: unknown): config is DevMuxConfig {
  if (!config || typeof config !== "object") return false;
  const c = config as Record<string, unknown>;

  if (c.version !== 1) return false;
  if (typeof c.project !== "string") return false;
  if (!c.services || typeof c.services !== "object") return false;

  return true;
}

function validateProxyHostnamePattern(
  hostnamePattern: string | undefined,
  configPath: string,
): void {
  if (hostnamePattern === undefined) return;

  const preview = hostnamePattern
    .replace(/\{service\}/g, "service")
    .replace(/\{project\}/g, "project")
    .trim()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .toLowerCase();

  if (!preview) {
    throw new Error(
      `Invalid devmux config in ${configPath}: proxy.hostnamePattern cannot be empty`,
    );
  }

  if (!preview.endsWith(".localhost") && preview.split(".").length >= 3) {
    throw new Error(
      `Invalid devmux config in ${configPath}: proxy.hostnamePattern must resolve to a .localhost hostname for local devmux routing`,
    );
  }
}

export function formatNoConfigError(): string {
  return [
    "No devmux config found.",
    "",
    "To fix this, either:",
    "",
    "  1. Create a config file:",
    "     devmux init > devmux.config.json",
    "",
    "  2. Auto-discover from turbo.json:",
    "     devmux discover > devmux.config.json",
    "",
    "  3. Add a 'devmux' key to your package.json",
    "",
    "  4. Or just use tmux directly:",
    "     tmux new-session -d -s my-service 'your-command'",
  ].join("\n");
}

export function loadConfig(startDir: string = process.cwd()): ResolvedConfig {
  const configPath = findConfigFile(startDir);

  if (!configPath) {
    throw new Error(formatNoConfigError());
  }

  const config = loadConfigFromFile(configPath);
  return resolveLoadedConfig(config, configPath);
}

export function loadConfigExact(
  projectRoot: string,
  options: { instanceId?: string } = {},
): ResolvedConfig {
  for (const name of CONFIG_NAMES) {
    const configPath = resolve(projectRoot, name);
    if (existsSync(configPath)) {
      const config = loadConfigFromFile(configPath);
      return resolveLoadedConfig(config, configPath, options.instanceId ?? "");
    }
  }

  const pkgPath = resolve(projectRoot, "package.json");
  if (existsSync(pkgPath)) {
    const config = loadConfigFromFile(pkgPath);
    return resolveLoadedConfig(config, pkgPath, options.instanceId ?? "");
  }

  throw new Error(
    `No devmux config found at ${projectRoot}.\n\nExpected one of: ${CONFIG_NAMES.join(", ")} or package.json#devmux\n\nRun \`devmux init > devmux.config.json\` to create one.`,
  );
}

export function getSessionName(
  config: ResolvedConfig,
  serviceName: string,
): string {
  const service = config.services[serviceName];
  if (service?.sessionName) {
    return sanitizeTmuxSessionName(service.sessionName);
  }
  if (config.instanceId) {
    return sanitizeTmuxSessionName(
      `${config.resolvedSessionPrefix}-${config.instanceId}-${serviceName}`,
    );
  }
  return sanitizeTmuxSessionName(
    `${config.resolvedSessionPrefix}-${serviceName}`,
  );
}

/**
 * Sanitize a string for use as a tmux session name.
 * tmux treats ':' and '.' as delimiters (session:window.pane),
 * so we replace them with '-' to avoid lookup failures.
 */
function sanitizeTmuxSessionName(name: string): string {
  return name.replace(/[:.]/g, "-");
}

export function getServiceCwd(
  config: ResolvedConfig,
  serviceName: string,
): string {
  const service = config.services[serviceName];
  if (!service) {
    throw new Error(`Unknown service: ${serviceName}`);
  }
  return resolve(config.configRoot, service.cwd);
}

export function getBasePort(
  health: HealthCheckType | undefined,
  explicitPort?: number,
): number | undefined {
  if (explicitPort !== undefined) return explicitPort;
  if (!health) return undefined;
  if (health.type === "port") return health.port;
  if (health.type === "http") {
    try {
      const url = new URL(health.url);
      return parseInt(url.port) || (url.protocol === "https:" ? 443 : 80);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function getResolvedPort(
  config: ResolvedConfig,
  serviceName: string,
): number | undefined {
  const service = config.services[serviceName];
  if (!service) return undefined;

  const basePort = getBasePort(service.health, service.port);
  if (basePort === undefined) return undefined;

  return resolvePort(basePort, config.instanceId);
}
