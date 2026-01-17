export type HealthCheckType =
  | { type: "port"; port: number; host?: string }
  | { type: "http"; url: string; expectStatus?: number }
  | { type: "none" };

export interface ServiceDefinition {
  cwd: string;
  command: string;
  health: HealthCheckType;
  sessionName?: string;
  env?: Record<string, string>;
  stopPorts?: number[];
  dependsOn?: string[];
  port?: number;
}

export interface DevMuxConfig {
  version: 1;
  project: string;
  sessionPrefix?: string;
  defaults?: {
    startupTimeoutSeconds?: number;
    remainOnExit?: boolean;
  };
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
