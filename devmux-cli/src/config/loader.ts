import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import type { DevMuxConfig, ResolvedConfig } from "./types.js";

const CONFIG_NAMES = [
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
    return pkg.devmux as DevMuxConfig;
  }

  return JSON.parse(content) as DevMuxConfig;
}

function validateConfig(config: unknown): config is DevMuxConfig {
  if (!config || typeof config !== "object") return false;
  const c = config as Record<string, unknown>;
  
  if (c.version !== 1) return false;
  if (typeof c.project !== "string") return false;
  if (!c.services || typeof c.services !== "object") return false;

  return true;
}

export function loadConfig(startDir: string = process.cwd()): ResolvedConfig {
  const configPath = findConfigFile(startDir);
  
  if (!configPath) {
    throw new Error(
      "No devmux config found. Create devmux.config.json or add 'devmux' to package.json"
    );
  }

  const config = loadConfigFromFile(configPath);

  if (!validateConfig(config)) {
    throw new Error(`Invalid devmux config in ${configPath}`);
  }

  const configRoot = dirname(configPath);
  const resolvedSessionPrefix =
    config.sessionPrefix ?? `omo-${config.project}`;

  return {
    ...config,
    configRoot,
    resolvedSessionPrefix,
  };
}

export function getSessionName(config: ResolvedConfig, serviceName: string): string {
  const service = config.services[serviceName];
  if (service?.sessionName) {
    return service.sessionName;
  }
  return `${config.resolvedSessionPrefix}-${serviceName}`;
}

export function getServiceCwd(config: ResolvedConfig, serviceName: string): string {
  const service = config.services[serviceName];
  if (!service) {
    throw new Error(`Unknown service: ${serviceName}`);
  }
  return resolve(config.configRoot, service.cwd);
}
