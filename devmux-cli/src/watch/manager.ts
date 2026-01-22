import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolvedConfig } from "../config/types.js";
import type { ServiceWatchState } from "./types.js";
import { getSessionName } from "../config/loader.js";
import * as tmux from "../tmux/driver.js";
import { resolvePatterns } from "./patterns.js";

function getWatcherCliPath(): string {
  const thisFileDir = dirname(fileURLToPath(import.meta.url));
  if (thisFileDir.endsWith("watch")) {
    return join(thisFileDir, "watcher-cli.js");
  }
  return join(thisFileDir, "watch", "watcher-cli.js");
}

function getWatchConfig(config: ResolvedConfig) {
  return config.watch;
}

function getServiceWatchConfig(config: ResolvedConfig, serviceName: string) {
  return config.services[serviceName]?.watch;
}

function isWatchEnabled(config: ResolvedConfig, serviceName: string): boolean {
  const globalWatch = getWatchConfig(config);
  const serviceWatch = getServiceWatchConfig(config, serviceName);

  if (serviceWatch?.enabled !== undefined) {
    return serviceWatch.enabled;
  }

  return globalWatch?.enabled ?? false;
}

function isPipeActive(sessionName: string): boolean {
  try {
    const output = execSync(`tmux show-options -t "${sessionName}" -p pipe-command 2>/dev/null || true`, {
      encoding: "utf-8",
    });
    return output.includes("watcher-cli");
  } catch {
    return false;
  }
}

export function getWatcherStatus(config: ResolvedConfig, serviceName: string): ServiceWatchState {
  const sessionName = getSessionName(config, serviceName);
  const hasSession = tmux.hasSession(sessionName);

  return {
    service: serviceName,
    sessionName,
    pipeActive: hasSession && isPipeActive(sessionName),
  };
}

export function getAllWatcherStatuses(config: ResolvedConfig): ServiceWatchState[] {
  return Object.keys(config.services).map((serviceName) => getWatcherStatus(config, serviceName));
}

export function startWatcher(
  config: ResolvedConfig,
  serviceName: string,
  options: { quiet?: boolean } = {}
): boolean {
  const sessionName = getSessionName(config, serviceName);
  const log = options.quiet ? () => {} : console.log;

  if (!tmux.hasSession(sessionName)) {
    log(`❌ Service ${serviceName} is not running (no tmux session: ${sessionName})`);
    return false;
  }

  if (isPipeActive(sessionName)) {
    log(`✅ Watcher already active for ${serviceName}`);
    return true;
  }

  const globalWatch = getWatchConfig(config);
  const serviceWatch = getServiceWatchConfig(config, serviceName);
  const patterns = resolvePatterns(globalWatch, serviceWatch);

  if (patterns.length === 0) {
    log(`⚠️ No patterns configured for ${serviceName}`);
    return false;
  }

  const outputDir = globalWatch?.outputDir ?? `${process.env.HOME}/.opencode/triggers`;
  const dedupeWindowMs = globalWatch?.dedupeWindowMs ?? 5000;
  const contextLines = globalWatch?.contextLines ?? 20;

  const patternsJson = JSON.stringify(patterns).replace(/"/g, '\\"');
  const watcherCliPath = getWatcherCliPath();
  const cmd = [
    `node "${watcherCliPath}"`,
    `--service=${serviceName}`,
    `--project=${config.project}`,
    `--session=${sessionName}`,
    `--output=${outputDir}`,
    `--dedupe=${dedupeWindowMs}`,
    `--context=${contextLines}`,
    `--patterns="${patternsJson}"`,
  ].join(" ");

  try {
    execSync(`tmux pipe-pane -t "${sessionName}" '${cmd}'`, { stdio: "pipe" });
    log(`👁️ Started watching ${serviceName}`);
    return true;
  } catch (e) {
    log(`❌ Failed to start watcher for ${serviceName}: ${e}`);
    return false;
  }
}

export function stopWatcher(
  config: ResolvedConfig,
  serviceName: string,
  options: { quiet?: boolean } = {}
): boolean {
  const sessionName = getSessionName(config, serviceName);
  const log = options.quiet ? () => {} : console.log;

  if (!tmux.hasSession(sessionName)) {
    log(`⚠️ Service ${serviceName} is not running`);
    return false;
  }

  if (!isPipeActive(sessionName)) {
    log(`⚠️ Watcher not active for ${serviceName}`);
    return false;
  }

  try {
    execSync(`tmux pipe-pane -t "${sessionName}"`, { stdio: "pipe" });
    log(`🛑 Stopped watching ${serviceName}`);
    return true;
  } catch (e) {
    log(`❌ Failed to stop watcher for ${serviceName}: ${e}`);
    return false;
  }
}

export function startAllWatchers(config: ResolvedConfig, options: { quiet?: boolean } = {}): void {
  for (const serviceName of Object.keys(config.services)) {
    if (isWatchEnabled(config, serviceName)) {
      startWatcher(config, serviceName, options);
    }
  }
}

export function stopAllWatchers(config: ResolvedConfig, options: { quiet?: boolean } = {}): void {
  for (const serviceName of Object.keys(config.services)) {
    const status = getWatcherStatus(config, serviceName);
    if (status.pipeActive) {
      stopWatcher(config, serviceName, options);
    }
  }
}
