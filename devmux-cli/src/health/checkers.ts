import { createConnection } from "node:net";
import type { HealthCheckType } from "../config/types.js";

export function checkPort(port: number, host: string = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    socket.setTimeout(1000);

    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });

    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });

    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export async function checkHttp(
  url: string,
  expectStatus: number = 200
): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    if (expectStatus === 200) {
      return response.ok || response.status === 404;
    }
    return response.status === expectStatus;
  } catch {
    return false;
  }
}

export async function checkHealth(health: HealthCheckType): Promise<boolean> {
  switch (health.type) {
    case "port":
      return checkPort(health.port, health.host);
    case "http":
      return checkHttp(health.url, health.expectStatus);
    case "none":
      return false;
  }
}

export function getHealthPort(health: HealthCheckType): number | undefined {
  if (health.type === "port") return health.port;
  if (health.type === "http") {
    try {
      const url = new URL(health.url);
      return parseInt(url.port) || (url.protocol === "https:" ? 443 : 80);
    } catch {
      return undefined;
    }
  }
  return undefined;
}
