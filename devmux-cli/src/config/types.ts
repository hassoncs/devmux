export type HealthCheckType =
  | { type: "port"; port: number; host?: string }
  | { type: "http"; url: string; expectStatus?: number }
  | { type: "none" };

export interface ErrorPatternConfig {
  name: string;
  regex: string;
  severity: "info" | "warning" | "error" | "critical";
  extractStackTrace?: boolean;
}

export interface GlobalWatchConfig {
  enabled?: boolean;
  outputDir?: string;
  dedupeWindowMs?: number;
  contextLines?: number;
  patternSets?: Record<string, ErrorPatternConfig[]>;
}

export interface ServiceWatchConfig {
  enabled?: boolean;
  include?: string[];
  exclude?: string[];
  patterns?: ErrorPatternConfig[];
  overrides?: Record<string, "info" | "warning" | "error" | "critical">;
}

export interface ServiceDefinition {
  cwd: string;
  command: string;
  health: HealthCheckType;
  sessionName?: string;
  env?: Record<string, string>;
  stopPorts?: number[];
  dependsOn?: string[];
  port?: number;
  watch?: ServiceWatchConfig;
}

export interface DevMuxConfig {
  version: 1;
  project: string;
  sessionPrefix?: string;
  defaults?: {
    startupTimeoutSeconds?: number;
    remainOnExit?: boolean;
  };
  watch?: GlobalWatchConfig;
  services: Record<string, ServiceDefinition>;
}

export interface ResolvedConfig extends DevMuxConfig {
  configRoot: string;
  resolvedSessionPrefix: string;
  instanceId: string;
}

export interface ServiceStatus {
  name: string;
  healthy: boolean;
  tmuxSession: string | null;
  port?: number;
  resolvedPort?: number;
  managedByDevmux: boolean;
  instanceId?: string;
}
