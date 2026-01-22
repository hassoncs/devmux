import type { HelloPayload, TelemetryResource, LogPayload } from "./protocol.js";
import { Transport } from "./transport.js";
import { detectPlatform, buildTelemetryPlatform, type PlatformInfo } from "./platform.js";
import { installConsoleCapture, uninstallConsoleCapture } from "./capture/console.js";
import { installErrorCapture, uninstallErrorCapture } from "./capture/errors.js";

const SDK_NAME = "@chriscode/devmux-telemetry";
const SDK_VERSION = "0.1.0";

export interface TelemetryClientOptions {
  serverUrl: string;
  serviceName: string;
  serviceVersion?: string;
  enabled?: boolean;
  captureConsole?: boolean;
  captureErrors?: boolean;
}

let clientInstance: TelemetryClient | null = null;

export class TelemetryClient {
  private transport: Transport;
  private options: Required<TelemetryClientOptions>;
  private platform: PlatformInfo;
  private clientId: string;

  constructor(options: TelemetryClientOptions) {
    this.platform = detectPlatform();
    this.clientId = this.generateClientId();

    this.options = {
      enabled: this.platform.isDev,
      captureConsole: true,
      captureErrors: true,
      serviceVersion: "0.0.0",
      ...options,
    };

    this.transport = new Transport({
      serverUrl: this.options.serverUrl,
      clientId: this.clientId,
      onSessionEstablished: (response) => {
        if (this.platform.isDev) {
          this.logInternal(`Connected to telemetry: ${response.streamName}`);
        }
      },
      onDisconnect: () => {
        if (this.platform.isDev) {
          this.logInternal("Telemetry disconnected, will reconnect...");
        }
      },
      onError: (error) => {
        if (this.platform.isDev) {
          this.logInternal(`Telemetry error: ${error.message}`);
        }
      },
    });
  }

  start(): void {
    if (!this.options.enabled) {
      return;
    }

    const hello = this.buildHelloPayload();
    this.transport.connect(hello);

    if (this.options.captureConsole) {
      installConsoleCapture((log) => this.handleLog(log));
    }

    if (this.options.captureErrors) {
      installErrorCapture((log) => this.handleLog(log));
    }
  }

  stop(reason?: string): void {
    uninstallConsoleCapture();
    uninstallErrorCapture();
    this.transport.disconnect(reason);
  }

  log(body: unknown, severityText = "log", severityNumber = 9): void {
    if (!this.options.enabled) return;

    const log: LogPayload = {
      timestamp: Date.now(),
      severityNumber,
      severityText,
      body,
    };

    this.transport.sendLog(log);
  }

  isConnected(): boolean {
    return this.transport.isConnected();
  }

  private handleLog(log: LogPayload): void {
    this.transport.sendLog(log);
  }

  private buildHelloPayload(): HelloPayload {
    const resource: TelemetryResource = {
      "service.name": this.options.serviceName,
      "service.version": this.options.serviceVersion,
      "telemetry.sdk.name": SDK_NAME,
      "telemetry.sdk.version": SDK_VERSION,
    };

    return {
      resource,
      platform: buildTelemetryPlatform(this.platform),
    };
  }

  private generateClientId(): string {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }

    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  private logInternal(message: string): void {
    const originalLog = console.log;
    originalLog.call(console, `[devmux-telemetry] ${message}`);
  }
}

export function initTelemetry(options: TelemetryClientOptions): TelemetryClient {
  if (clientInstance) {
    return clientInstance;
  }

  clientInstance = new TelemetryClient(options);
  clientInstance.start();

  return clientInstance;
}

export function shutdownTelemetry(reason?: string): void {
  if (clientInstance) {
    clientInstance.stop(reason);
    clientInstance = null;
  }
}

export function getTelemetryClient(): TelemetryClient | null {
  return clientInstance;
}
