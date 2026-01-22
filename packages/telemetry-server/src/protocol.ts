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
  TRACE2: 2,
  TRACE3: 3,
  TRACE4: 4,
  DEBUG: 5,
  DEBUG2: 6,
  DEBUG3: 7,
  DEBUG4: 8,
  INFO: 9,
  INFO2: 10,
  INFO3: 11,
  INFO4: 12,
  WARN: 13,
  WARN2: 14,
  WARN3: 15,
  WARN4: 16,
  ERROR: 17,
  ERROR2: 18,
  ERROR3: 19,
  ERROR4: 20,
  FATAL: 21,
  FATAL2: 22,
  FATAL3: 23,
  FATAL4: 24,
} as const;

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export function validateEnvelope(
  data: unknown
): ValidationResult<TelemetryEnvelope> {
  if (typeof data !== "object" || data === null) {
    return { ok: false, error: "Message must be an object" };
  }

  const msg = data as Record<string, unknown>;

  if (msg.protocol !== PROTOCOL_NAME) {
    return { ok: false, error: `Invalid protocol: expected "${PROTOCOL_NAME}"` };
  }

  if (msg.version !== PROTOCOL_VERSION) {
    return {
      ok: false,
      error: `Unsupported protocol version: ${msg.version}`,
    };
  }

  if (!["hello", "goodbye", "log"].includes(msg.type as string)) {
    return { ok: false, error: `Invalid message type: ${msg.type}` };
  }

  if (typeof msg.payload !== "object" || msg.payload === null) {
    return { ok: false, error: "Payload must be an object" };
  }

  if (typeof msg.meta !== "object" || msg.meta === null) {
    return { ok: false, error: "Meta must be an object" };
  }

  const meta = msg.meta as Record<string, unknown>;
  if (typeof meta.clientId !== "string") {
    return { ok: false, error: "meta.clientId must be a string" };
  }

  if (typeof meta.timestamp !== "number") {
    return { ok: false, error: "meta.timestamp must be a number" };
  }

  return { ok: true, data: msg as unknown as TelemetryEnvelope };
}

export function validateHelloPayload(
  payload: unknown
): ValidationResult<HelloPayload> {
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, error: "Hello payload must be an object" };
  }

  const p = payload as Record<string, unknown>;

  if (typeof p.resource !== "object" || p.resource === null) {
    return { ok: false, error: "Hello payload must have resource" };
  }

  const resource = p.resource as Record<string, unknown>;
  if (typeof resource["service.name"] !== "string") {
    return { ok: false, error: "resource.service.name must be a string" };
  }

  if (typeof p.platform !== "object" || p.platform === null) {
    return { ok: false, error: "Hello payload must have platform" };
  }

  const platform = p.platform as Record<string, unknown>;
  if (
    !["browser", "react-native", "expo", "node"].includes(
      platform.kind as string
    )
  ) {
    return { ok: false, error: "Invalid platform.kind" };
  }

  return { ok: true, data: p as unknown as HelloPayload };
}

export function validateLogPayload(
  payload: unknown
): ValidationResult<LogPayload> {
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, error: "Log payload must be an object" };
  }

  const p = payload as Record<string, unknown>;

  if (typeof p.timestamp !== "number") {
    return { ok: false, error: "Log payload must have numeric timestamp" };
  }

  if (typeof p.severityNumber !== "number") {
    return { ok: false, error: "Log payload must have numeric severityNumber" };
  }

  if (typeof p.severityText !== "string") {
    return { ok: false, error: "Log payload must have string severityText" };
  }

  return { ok: true, data: p as unknown as LogPayload };
}
