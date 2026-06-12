import { createConnection } from "node:net";
import { execSync } from "node:child_process";
import type { HealthCheckType } from "../config/types.js";

export function checkPort(port: number, host: string = "localhost"): Promise<boolean> {
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
  expectStatus?: number
): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    if (expectStatus !== undefined) {
      return response.status === expectStatus;
    }
    // Default: any status < 500 is healthy (server is up and responding)
    return response.status < 500;
  } catch {
    return false;
  }
}

export function checkTmuxPane(sessionName: string): boolean {
  try {
    const output = execSync(
      `tmux list-panes -t "${sessionName}" -F "#{pane_dead}"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
    // pane_dead = 0 means alive, 1 means dead.
    // With multiple panes, output has one line per pane — session is alive
    // when at least one pane exists and ALL panes report 0 (not dead).
    const lines = output.trim().split("\n").filter((l) => l.length > 0);
    return lines.length > 0 && lines.every((l) => l === "0");
  } catch {
    // Session doesn't exist or tmux error
    return false;
  }
}

export async function checkHealth(
  health: HealthCheckType | undefined,
  sessionName: string
): Promise<boolean> {
  // If no health check specified, use tmux pane check as default
  if (!health) {
    return checkTmuxPane(sessionName);
  }

  switch (health.type) {
    case "port":
      return checkPort(health.port, health.host);
    case "http":
      return checkHttp(health.url, health.expectStatus);
    case "none":
      return checkTmuxPane(sessionName);
  }
}

export function getHealthPort(health: HealthCheckType | undefined): number | undefined {
  if (!health) return undefined;
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
