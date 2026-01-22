export type {
  DevMuxConfig,
  ResolvedConfig,
  ServiceDefinition,
  ServiceStatus,
  HealthCheckType,
} from "./config/types.js";

export { loadConfig, getSessionName, getServiceCwd } from "./config/loader.js";

export {
  ensureService,
  getStatus,
  getAllStatus,
  stopService,
  stopAllServices,
  attachService,
  type EnsureResult,
} from "./core/service.js";

export { runWithServices, type RunOptions } from "./core/run.js";

export { discoverFromTurbo, formatDiscoveredConfig } from "./discovery/turbo.js";

export * as tmux from "./tmux/driver.js";
export * as health from "./health/checkers.js";
export * as watch from "./watch/index.js";
