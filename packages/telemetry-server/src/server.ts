import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import {
  validateEnvelope,
  validateHelloPayload,
  validateLogPayload,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  type TelemetryEnvelope,
  type HelloPayload,
  type LogPayload,
  type HelloResponse,
} from "./protocol.js";
import { SessionManager, type Session } from "./session.js";
import { Router } from "./router.js";

export interface TelemetryServerOptions {
  port?: number;
  host?: string;
  outputDir?: string;
}

export interface TelemetryServerStatus {
  running: boolean;
  port: number;
  host: string;
  sessionCount: number;
  sessions: Array<{
    id: string;
    streamName: string;
    serviceName: string;
    platform: string;
    eventCount: number;
    connectedAt: string;
  }>;
}

export class TelemetryServer {
  private wss: WebSocketServer | null = null;
  private sessionManager = new SessionManager();
  private router: Router;
  private port: number;
  private host: string;

  constructor(options: TelemetryServerOptions = {}) {
    this.port = options.port ?? 9876;
    this.host = options.host ?? "0.0.0.0";
    this.router = new Router(options.outputDir);
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({
          port: this.port,
          host: this.host,
        });

        this.wss.on("connection", (ws, req) => this.handleConnection(ws, req));
        this.wss.on("error", (error) => {
          console.error("[telemetry-server] Error:", error);
        });

        this.wss.on("listening", () => {
          console.log(
            `[telemetry-server] Listening on ws://${this.host}:${this.port}`
          );
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.wss) {
        resolve();
        return;
      }

      for (const session of this.sessionManager.getAllSessions()) {
        this.router.closeStream(session.streamName);
      }

      this.wss.close(() => {
        this.wss = null;
        console.log("[telemetry-server] Stopped");
        resolve();
      });
    });
  }

  getStatus(): TelemetryServerStatus {
    const sessions = this.sessionManager.getAllSessions();

    return {
      running: this.wss !== null,
      port: this.port,
      host: this.host,
      sessionCount: sessions.length,
      sessions: sessions.map((s) => ({
        id: s.id,
        streamName: s.streamName,
        serviceName: s.serviceName,
        platform: s.platform.kind,
        eventCount: s.eventCount,
        connectedAt: s.connectedAt.toISOString(),
      })),
    };
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    let session: Session | null = null;

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        const validation = validateEnvelope(message);

        if (!validation.ok) {
          this.sendError(ws, validation.error);
          return;
        }

        const envelope = validation.data;

        switch (envelope.type) {
          case "hello":
            session = this.handleHello(ws, envelope);
            break;

          case "goodbye":
            this.handleGoodbye(session);
            session = null;
            break;

          case "log":
            if (session) {
              this.handleLog(session, envelope);
            } else {
              this.sendError(ws, "Must send hello before log");
            }
            break;
        }
      } catch (error) {
        this.sendError(
          ws,
          `Invalid message: ${error instanceof Error ? error.message : "parse error"}`
        );
      }
    });

    ws.on("close", () => {
      if (session) {
        this.handleGoodbye(session);
      }
    });

    ws.on("error", (error) => {
      console.error("[telemetry-server] WebSocket error:", error);
    });
  }

  private handleHello(
    ws: WebSocket,
    envelope: TelemetryEnvelope
  ): Session | null {
    const validation = validateHelloPayload(envelope.payload);

    if (!validation.ok) {
      this.sendError(ws, validation.error);
      return null;
    }

    const hello = validation.data;
    const session = this.sessionManager.createSession(
      ws,
      envelope.meta.clientId,
      hello
    );

    this.router.ensureStream(session);

    const response: HelloResponse = {
      sessionId: session.id,
      streamName: session.streamName,
    };

    ws.send(
      JSON.stringify({
        protocol: PROTOCOL_NAME,
        version: PROTOCOL_VERSION,
        type: "hello-ack",
        payload: response,
        meta: {
          timestamp: Date.now(),
        },
      })
    );

    console.log(
      `[telemetry-server] New session: ${session.streamName} (${session.serviceName})`
    );

    return session;
  }

  private handleGoodbye(session: Session | null): void {
    if (!session) return;

    this.router.closeStream(session.streamName);
    this.sessionManager.closeSession(session.id);

    console.log(
      `[telemetry-server] Session closed: ${session.streamName} (${session.eventCount} events)`
    );
  }

  private handleLog(session: Session, envelope: TelemetryEnvelope): void {
    const validation = validateLogPayload(envelope.payload);

    if (!validation.ok) {
      console.error(
        `[telemetry-server] Invalid log payload: ${validation.error}`
      );
      return;
    }

    const log = validation.data;
    this.sessionManager.incrementEventCount(session.id);
    this.router.routeLog(session, log);
  }

  private sendError(ws: WebSocket, error: string): void {
    ws.send(
      JSON.stringify({
        protocol: PROTOCOL_NAME,
        version: PROTOCOL_VERSION,
        type: "error",
        payload: { error },
        meta: {
          timestamp: Date.now(),
        },
      })
    );
  }
}

export function createServer(
  options?: TelemetryServerOptions
): TelemetryServer {
  return new TelemetryServer(options);
}
