import type { LogPayload } from "../protocol.js";
import { SeverityNumber } from "../protocol.js";

type ConsoleMethod = "log" | "debug" | "info" | "warn" | "error" | "trace";

const CONSOLE_SEVERITY: Record<ConsoleMethod, number> = {
  trace: SeverityNumber.TRACE,
  debug: SeverityNumber.DEBUG,
  log: SeverityNumber.INFO,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

const originalMethods: Partial<Record<ConsoleMethod, (...args: unknown[]) => void>> = {};

let logHandler: ((log: LogPayload) => void) | null = null;

function wrapConsoleMethod(method: ConsoleMethod): void {
  const original = console[method];
  if (typeof original !== "function") return;

  originalMethods[method] = original;

  console[method] = (...args: unknown[]) => {
    original.apply(console, args);

    if (!logHandler) return;

    const log: LogPayload = {
      timestamp: Date.now(),
      severityNumber: CONSOLE_SEVERITY[method],
      severityText: method,
      body: args.length === 1 ? args[0] : args,
      source: extractSource(),
    };

    logHandler(log);
  };
}

function extractSource(): { file?: string; line?: number; column?: number } | undefined {
  try {
    const stack = new Error().stack;
    if (!stack) return undefined;

    const lines = stack.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (
        !line.includes("console.ts") &&
        !line.includes("at console.") &&
        !line.includes("at Object.")
      ) {
        const match = line.match(/(?:at\s+)?(?:.*?\s+\()?(.+?):(\d+):(\d+)\)?/);
        if (match) {
          return {
            file: match[1],
            line: parseInt(match[2], 10),
            column: parseInt(match[3], 10),
          };
        }
      }
    }
  } catch {
    // Ignore stack trace errors
  }
  return undefined;
}

export function installConsoleCapture(handler: (log: LogPayload) => void): void {
  logHandler = handler;

  const methods: ConsoleMethod[] = ["log", "debug", "info", "warn", "error", "trace"];
  for (const method of methods) {
    wrapConsoleMethod(method);
  }
}

export function uninstallConsoleCapture(): void {
  logHandler = null;

  for (const [method, original] of Object.entries(originalMethods)) {
    if (original) {
      console[method as ConsoleMethod] = original;
    }
  }
}
