import type { LogPayload } from "../protocol.js";

const MAX_BUFFER_SIZE = 100;

interface BufferedLog extends LogPayload {
  _isBufferedLog: true;
}

declare global {
  interface Window {
    __DEVMUX_TELEMETRY_BUFFER__?: BufferedLog[];
  }
}

export function getGlobalBuffer(): BufferedLog[] {
  if (typeof window !== "undefined") {
    if (!window.__DEVMUX_TELEMETRY_BUFFER__) {
      window.__DEVMUX_TELEMETRY_BUFFER__ = [];
    }
    return window.__DEVMUX_TELEMETRY_BUFFER__;
  }

  if (typeof global !== "undefined") {
    const g = global as unknown as { __DEVMUX_TELEMETRY_BUFFER__?: BufferedLog[] };
    if (!g.__DEVMUX_TELEMETRY_BUFFER__) {
      g.__DEVMUX_TELEMETRY_BUFFER__ = [];
    }
    return g.__DEVMUX_TELEMETRY_BUFFER__;
  }

  return [];
}

export function addToBuffer(log: LogPayload): void {
  const buffer = getGlobalBuffer();

  if (buffer.length >= MAX_BUFFER_SIZE) {
    buffer.shift();
  }

  buffer.push({ ...log, _isBufferedLog: true });
}

export function getBufferedLogs(): LogPayload[] {
  return getGlobalBuffer().map((log) => {
    const { _isBufferedLog, ...rest } = log as BufferedLog & { _isBufferedLog: boolean };
    return rest;
  });
}

export function clearBuffer(): void {
  const buffer = getGlobalBuffer();
  buffer.length = 0;
}

export function hasBufferedLogs(): boolean {
  return getGlobalBuffer().length > 0;
}
