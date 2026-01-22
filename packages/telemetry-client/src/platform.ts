import type { PlatformKind, TelemetryPlatform } from "./protocol.js";

declare const __DEV__: boolean | undefined;

export interface PlatformInfo {
  kind: PlatformKind;
  os?: string;
  url?: string;
  userAgent?: string;
  bundler?: string;
  isDev: boolean;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function isReactNative(): boolean {
  return (
    typeof navigator !== "undefined" &&
    navigator.product === "ReactNative"
  );
}

function isExpo(): boolean {
  return (
    isReactNative() &&
    typeof global !== "undefined" &&
    (global as Record<string, unknown>).expo !== undefined
  );
}

function getOS(): string | undefined {
  if (isBrowser()) {
    return "web";
  }

  if (isReactNative()) {
    const globalAny = global as unknown as Record<string, { OS?: string }>;
    const Platform = globalAny.Platform;
    if (Platform?.OS) {
      return Platform.OS;
    }
  }

  return undefined;
}

function getURL(): string | undefined {
  if (isBrowser() && typeof window.location !== "undefined") {
    return window.location.href;
  }
  return undefined;
}

function getUserAgent(): string | undefined {
  if (isBrowser() && typeof navigator !== "undefined") {
    return navigator.userAgent;
  }
  return undefined;
}

function isDevelopment(): boolean {
  if (typeof __DEV__ !== "undefined") {
    return __DEV__;
  }

  if (typeof process !== "undefined" && process.env?.NODE_ENV) {
    return process.env.NODE_ENV !== "production";
  }

  return true;
}

export function detectPlatform(): PlatformInfo {
  let kind: PlatformKind = "browser";

  if (isExpo()) {
    kind = "expo";
  } else if (isReactNative()) {
    kind = "react-native";
  } else if (isBrowser()) {
    kind = "browser";
  } else {
    kind = "node";
  }

  return {
    kind,
    os: getOS(),
    url: getURL(),
    userAgent: getUserAgent(),
    isDev: isDevelopment(),
  };
}

export function buildTelemetryPlatform(info: PlatformInfo): TelemetryPlatform {
  return {
    kind: info.kind,
    os: info.os,
    url: info.url,
    userAgent: info.userAgent,
    bundler: info.bundler,
  };
}
