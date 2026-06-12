export const PROTOCOL_NAME = "devmux-telemetry";
export const PROTOCOL_VERSION = 1;

export type MessageType = "hello" | "goodbye" | "log";

export type PlatformKind = "browser" | "react-native" | "expo" | "node";

export interface TelemetryResource {
  "service.name": string;
  "service.version"?: string;
  "telemetry.sdk.name": string;
  "telemetry.sdk.version": string;
}

export interface TelemetryPlatform {
  kind: PlatformKind;
  os?: string;
  url?: string;
  userAgent?: string;
  bundler?: string;
}

export interface TelemetryMeta {
  clientId: string;
  sessionId?: string;
  timestamp: number;
}

export interface TelemetryEnvelope<TPayload = unknown> {
  protocol: typeof PROTOCOL_NAME;
  version: typeof PROTOCOL_VERSION;
  type: MessageType;
  payload: TPayload;
  meta: TelemetryMeta;
}

export interface HelloPayload {
  resource: TelemetryResource;
  platform: TelemetryPlatform;
}

export interface GoodbyePayload {
  reason?: string;
}

export interface LogSource {
  file?: string;
  line?: number;
  column?: number;
}

export interface LogException {
  type: string;
  message: string;
  stacktrace?: string;
  isUnhandled?: boolean;
}

export interface LogPayload {
  timestamp: number;
  severityNumber: number;
  severityText: string;
  body: unknown;
  attributes?: Record<string, unknown>;
  source?: LogSource;
  exception?: LogException;
}

export interface HelloResponse {
  sessionId: string;
  streamName: string;
}

export const SeverityNumber = {
  TRACE: 1,
  DEBUG: 5,
  INFO: 9,
  WARN: 13,
  ERROR: 17,
  FATAL: 21,
} as const;
