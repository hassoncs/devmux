export type {
  DevMuxConfig,
  ResolvedConfig,
  ServiceDefinition,
  ServiceStatus,
  HealthCheckType,
  ProxyConfig,
  PortConflictInfo,
} from "./config/types.js";

export { loadConfig, getSessionName, getServiceCwd } from "./config/loader.js";

export {
  ensureService,
  restartService,
  getStatus,
  getAllStatus,
  stopService,
  stopAllServices,
  attachService,
  PortConflictError,
  type EnsureResult,
} from "./core/service.js";

export { runWithServices, type RunOptions } from "./core/run.js";

export { discoverFromTurbo, formatDiscoveredConfig } from "./discovery/turbo.js";

export * as tmux from "./tmux/driver.js";
export * as health from "./health/checkers.js";
export * as watch from "./watch/index.js";
export * as dashboard from "./dashboard/index.js";
export * as proxy from "./proxy/manager.js";
