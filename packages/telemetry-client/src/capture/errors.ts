import type { LogPayload } from "../protocol.js";
import { SeverityNumber } from "../protocol.js";

let errorHandler: ((log: LogPayload) => void) | null = null;

let originalOnError: OnErrorEventHandler | null = null;
let originalOnUnhandledRejection: ((event: PromiseRejectionEvent) => void) | null = null;

function handleError(
  message: string | Event,
  source?: string,
  lineno?: number,
  colno?: number,
  error?: Error
): void {
  if (!errorHandler) return;

  const err = error ?? (message instanceof Error ? message : null);

  const log: LogPayload = {
    timestamp: Date.now(),
    severityNumber: SeverityNumber.ERROR,
    severityText: "error",
    body: err?.message ?? String(message),
    source: {
      file: source,
      line: lineno,
      column: colno,
    },
    exception: err
      ? {
          type: err.name,
          message: err.message,
          stacktrace: err.stack,
          isUnhandled: true,
        }
      : {
          type: "Error",
          message: String(message),
          isUnhandled: true,
        },
  };

  errorHandler(log);
}

function handleUnhandledRejection(event: PromiseRejectionEvent): void {
  if (!errorHandler) return;

  const reason = event.reason;
  const isError = reason instanceof Error;

  const log: LogPayload = {
    timestamp: Date.now(),
    severityNumber: SeverityNumber.ERROR,
    severityText: "error",
    body: isError ? reason.message : String(reason),
    exception: isError
      ? {
          type: reason.name,
          message: reason.message,
          stacktrace: reason.stack,
          isUnhandled: true,
        }
      : {
          type: "UnhandledRejection",
          message: String(reason),
          isUnhandled: true,
        },
  };

  errorHandler(log);
}

export function installErrorCapture(handler: (log: LogPayload) => void): void {
  errorHandler = handler;

  if (typeof window !== "undefined") {
    originalOnError = window.onerror;
    window.onerror = (message, source, lineno, colno, error) => {
      handleError(message, source, lineno, colno, error);
      if (originalOnError) {
        return originalOnError(message, source, lineno, colno, error);
      }
      return false;
    };

    originalOnUnhandledRejection = window.onunhandledrejection as typeof originalOnUnhandledRejection;
    window.onunhandledrejection = (event) => {
      handleUnhandledRejection(event);
      if (originalOnUnhandledRejection) {
        originalOnUnhandledRejection(event);
      }
    };
  }

  if (typeof global !== "undefined" && isReactNative()) {
    installReactNativeErrorHandler();
  }
}

export function uninstallErrorCapture(): void {
  errorHandler = null;

  if (typeof window !== "undefined") {
    window.onerror = originalOnError;
    window.onunhandledrejection = originalOnUnhandledRejection;
    originalOnError = null;
    originalOnUnhandledRejection = null;
  }
}

function isReactNative(): boolean {
  return (
    typeof navigator !== "undefined" &&
    navigator.product === "ReactNative"
  );
}

function installReactNativeErrorHandler(): void {
  const globalAny = global as unknown as {
    ErrorUtils?: {
      setGlobalHandler: (handler: (error: Error, isFatal: boolean) => void) => void;
      getGlobalHandler: () => (error: Error, isFatal: boolean) => void;
    };
  };

  if (!globalAny.ErrorUtils) return;

  const originalHandler = globalAny.ErrorUtils.getGlobalHandler();

  globalAny.ErrorUtils.setGlobalHandler((error: Error, isFatal: boolean) => {
    if (errorHandler) {
      const log: LogPayload = {
        timestamp: Date.now(),
        severityNumber: isFatal ? SeverityNumber.FATAL : SeverityNumber.ERROR,
        severityText: isFatal ? "fatal" : "error",
        body: error.message,
        exception: {
          type: error.name,
          message: error.message,
          stacktrace: error.stack,
          isUnhandled: true,
        },
        attributes: {
          isFatal,
        },
      };
      errorHandler(log);
    }

    if (originalHandler) {
      originalHandler(error, isFatal);
    }
  });
}
