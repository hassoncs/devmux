import type { LogPayload } from "./protocol.js";
import { SeverityNumber } from "./protocol.js";

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  bold: "\x1b[1m",
};

function getSeverityColor(severityNumber: number): string {
  if (severityNumber >= SeverityNumber.ERROR) {
    return ANSI.red;
  }
  if (severityNumber >= SeverityNumber.WARN) {
    return ANSI.yellow;
  }
  if (severityNumber >= SeverityNumber.INFO) {
    return ANSI.blue;
  }
  if (severityNumber >= SeverityNumber.DEBUG) {
    return ANSI.cyan;
  }
  return ANSI.gray;
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  const ms = date.getMilliseconds().toString().padStart(3, "0");
  return `${hours}:${minutes}:${seconds}.${ms}`;
}

function formatSeverityText(severityText: string): string {
  return severityText.toUpperCase().padEnd(5);
}

function formatBody(body: unknown): string {
  if (body === null) return "null";
  if (body === undefined) return "undefined";

  if (typeof body === "string") return body;
  if (typeof body === "number" || typeof body === "boolean") {
    return String(body);
  }

  if (Array.isArray(body)) {
    return body
      .map((item) => {
        if (typeof item === "string") return item;
        try {
          return JSON.stringify(item, null, 2);
        } catch {
          return String(item);
        }
      })
      .join(" ");
  }

  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return String(body);
  }
}

function formatSource(source?: { file?: string; line?: number; column?: number }): string {
  if (!source?.file) return "";
  
  let result = source.file;
  if (source.line !== undefined) {
    result += `:${source.line}`;
    if (source.column !== undefined) {
      result += `:${source.column}`;
    }
  }
  return result;
}

export function formatLogForTmux(log: LogPayload, streamName: string): string {
  const color = getSeverityColor(log.severityNumber);
  const timestamp = formatTimestamp(log.timestamp);
  const severity = formatSeverityText(log.severityText);
  const body = formatBody(log.body);
  const source = formatSource(log.source);

  let output = `${ANSI.dim}${timestamp}${ANSI.reset} ${color}${severity}${ANSI.reset}`;

  if (source) {
    output += ` ${ANSI.dim}[${source}]${ANSI.reset}`;
  }

  output += ` ${body}`;

  if (log.exception) {
    output += `\n${ANSI.red}${ANSI.bold}${log.exception.type}: ${log.exception.message}${ANSI.reset}`;
    if (log.exception.stacktrace) {
      output += `\n${ANSI.dim}${log.exception.stacktrace}${ANSI.reset}`;
    }
  }

  return output;
}

export function formatLogForQueue(log: LogPayload): string {
  const body = formatBody(log.body);

  if (log.exception) {
    return `${log.exception.type}: ${log.exception.message}`;
  }

  return body.slice(0, 200);
}
