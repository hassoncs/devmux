import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { HelloPayload, TelemetryPlatform } from "./protocol.js";

export interface Session {
  id: string;
  streamName: string;
  clientId: string;
  ws: WebSocket;
  platform: TelemetryPlatform;
  serviceName: string;
  connectedAt: Date;
  eventCount: number;
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private clientToSession = new Map<string, string>();

  createSession(ws: WebSocket, clientId: string, hello: HelloPayload): Session {
    const existingSessionId = this.clientToSession.get(clientId);
    if (existingSessionId) {
      const existing = this.sessions.get(existingSessionId);
      if (existing) {
        existing.ws = ws;
        return existing;
      }
    }

    const sessionId = randomUUID();
    const streamName = this.computeStreamName(hello);

    const session: Session = {
      id: sessionId,
      streamName,
      clientId,
      ws,
      platform: hello.platform,
      serviceName: hello.resource["service.name"],
      connectedAt: new Date(),
      eventCount: 0,
    };

    this.sessions.set(sessionId, session);
    this.clientToSession.set(clientId, sessionId);

    return session;
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionByClientId(clientId: string): Session | undefined {
    const sessionId = this.clientToSession.get(clientId);
    if (!sessionId) return undefined;
    return this.sessions.get(sessionId);
  }

  closeSession(sessionId: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    this.sessions.delete(sessionId);
    this.clientToSession.delete(session.clientId);

    return session;
  }

  closeSessionByWs(ws: WebSocket): Session | undefined {
    for (const [sessionId, session] of this.sessions) {
      if (session.ws === ws) {
        return this.closeSession(sessionId);
      }
    }
    return undefined;
  }

  incrementEventCount(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.eventCount++;
    }
  }

  getAllSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  private computeStreamName(hello: HelloPayload): string {
    const { platform, resource } = hello;
    const serviceName = resource["service.name"];

    switch (platform.kind) {
      case "browser": {
        if (platform.url) {
          try {
            const url = new URL(platform.url);
            return `browser:${url.hostname}${url.port ? `-${url.port}` : ""}`;
          } catch {
            return `browser:${serviceName}`;
          }
        }
        return `browser:${serviceName}`;
      }

      case "expo": {
        const os = platform.os ?? "unknown";
        return `expo:${serviceName}-${os}`;
      }

      case "react-native": {
        const os = platform.os ?? "unknown";
        return `rn:${serviceName}-${os}`;
      }

      case "node": {
        return `node:${serviceName}`;
      }

      default:
        return `client:${serviceName}`;
    }
  }
}
