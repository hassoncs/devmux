import {
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  type TelemetryEnvelope,
  type LogPayload,
  type HelloPayload,
  type GoodbyePayload,
  type HelloResponse,
} from "./protocol.js";

export interface TransportOptions {
  serverUrl: string;
  clientId: string;
  onSessionEstablished?: (response: HelloResponse) => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
  reconnectDelayMs?: number;
  maxReconnectAttempts?: number;
}

type MessageHandler = (data: unknown) => void;

export class Transport {
  private ws: WebSocket | null = null;
  private options: Required<TransportOptions>;
  private sessionId: string | null = null;
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private messageQueue: TelemetryEnvelope[] = [];
  private isConnecting = false;
  private helloPayload: HelloPayload | null = null;
  private messageHandler: MessageHandler | null = null;

  constructor(options: TransportOptions) {
    this.options = {
      reconnectDelayMs: 1000,
      maxReconnectAttempts: 10,
      onSessionEstablished: () => {},
      onDisconnect: () => {},
      onError: () => {},
      ...options,
    };
  }

  connect(hello: HelloPayload): void {
    if (this.ws || this.isConnecting) {
      return;
    }

    this.helloPayload = hello;
    this.isConnecting = true;

    try {
      this.ws = new WebSocket(this.options.serverUrl);

      this.ws.onopen = () => {
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.sendHello();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch {
          // Ignore parse errors
        }
      };

      this.ws.onclose = () => {
        this.ws = null;
        this.sessionId = null;
        this.isConnecting = false;
        this.options.onDisconnect();
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.options.onError(new Error("WebSocket error"));
      };
    } catch (error) {
      this.isConnecting = false;
      this.options.onError(
        error instanceof Error ? error : new Error(String(error))
      );
      this.scheduleReconnect();
    }
  }

  disconnect(reason?: string): void {
    this.clearReconnect();

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendGoodbye(reason);
      this.ws.close();
    }

    this.ws = null;
    this.sessionId = null;
  }

  sendLog(log: LogPayload): void {
    const envelope = this.createEnvelope("log", log);

    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.sessionId) {
      this.ws.send(JSON.stringify(envelope));
    } else {
      this.messageQueue.push(envelope);
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.sessionId !== null;
  }

  private sendHello(): void {
    if (!this.ws || !this.helloPayload) return;

    const envelope = this.createEnvelope("hello", this.helloPayload);
    this.ws.send(JSON.stringify(envelope));
  }

  private sendGoodbye(reason?: string): void {
    if (!this.ws) return;

    const payload: GoodbyePayload = { reason };
    const envelope = this.createEnvelope("goodbye", payload);
    this.ws.send(JSON.stringify(envelope));
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "object" || data === null) return;

    const msg = data as Record<string, unknown>;

    if (msg.type === "hello-ack") {
      const payload = msg.payload as HelloResponse;
      this.sessionId = payload.sessionId;
      this.options.onSessionEstablished(payload);
      this.flushQueue();
    }

    if (this.messageHandler) {
      this.messageHandler(data);
    }
  }

  private flushQueue(): void {
    if (!this.ws || !this.sessionId) return;

    for (const envelope of this.messageQueue) {
      envelope.meta.sessionId = this.sessionId;
      this.ws.send(JSON.stringify(envelope));
    }

    this.messageQueue = [];
  }

  private createEnvelope<T>(
    type: "hello" | "goodbye" | "log",
    payload: T
  ): TelemetryEnvelope<T> {
    return {
      protocol: PROTOCOL_NAME,
      version: PROTOCOL_VERSION,
      type,
      payload,
      meta: {
        clientId: this.options.clientId,
        sessionId: this.sessionId ?? undefined,
        timestamp: Date.now(),
      },
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      return;
    }

    this.reconnectAttempts++;
    const delay = this.options.reconnectDelayMs * this.reconnectAttempts;

    this.reconnectTimeout = setTimeout(() => {
      if (this.helloPayload) {
        this.connect(this.helloPayload);
      }
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.reconnectAttempts = 0;
  }
}
