export {
  initTelemetry,
  shutdownTelemetry,
  getTelemetryClient,
  TelemetryClient,
  type TelemetryClientOptions,
} from "./client.js";

export {
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  SeverityNumber,
  type MessageType,
  type PlatformKind,
  type TelemetryResource,
  type TelemetryPlatform,
  type TelemetryMeta,
  type TelemetryEnvelope,
  type HelloPayload,
  type GoodbyePayload,
  type LogPayload,
  type LogSource,
  type LogException,
  type HelloResponse,
} from "./protocol.js";

export { detectPlatform, type PlatformInfo } from "./platform.js";
