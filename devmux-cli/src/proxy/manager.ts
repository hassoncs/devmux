import { createServer } from "node:net";
import type { ResolvedConfig } from "../config/types.js";
import { getResolvedPort } from "../config/loader.js";
import { caddy } from "./caddy.js";
import { isPortReserved, reservePort, sweepExpiredReservations } from "../utils/lock.js";
import {
  buildProxyTeardownCommands,
  formatProxyDoctorReport,
  getProxyDoctorReport,
  printTeardownInstructions,
  tryStartManagedProxy,
} from "./system.js";

export { buildProxyTeardownCommands, printTeardownInstructions };

const MIN_AUTO_PORT = 4000;
const MAX_AUTO_PORT = 4999;
const RANDOM_PORT_ATTEMPTS = 50;

export function parseHostname(input: string): string {
  let hostname = input
    .trim()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .toLowerCase();
  if (!hostname || hostname === ".localhost") {
    throw new Error("Hostname cannot be empty");
  }
  if (!hostname.endsWith(".localhost") && hostname.split(".").length < 3) {
    hostname = `${hostname}.localhost`;
  }
  const name = hostname.endsWith(".localhost")
    ? hostname.replace(/\.localhost$/, "")
    : hostname;
  if (name.includes("..")) {
    throw new Error(
      `Invalid hostname "${name}": consecutive dots are not allowed`,
    );
  }
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(name)) {
    throw new Error(
      `Invalid hostname "${name}": must contain only lowercase letters, digits, hyphens, and dots`,
    );
  }
  if (!hostname.endsWith(".localhost")) {
    throw new Error(
      `Invalid hostname "${hostname}": local devmux proxy hostnames must end with .localhost`,
    );
  }
  return hostname;
}

export function formatUrl(hostname: string): string {
  return `http://${hostname}`;
}

export function isProxyEnabled(config: ResolvedConfig): boolean {
  return config.proxy?.enabled === true;
}

export function isServiceProxied(
  config: ResolvedConfig,
  serviceName: string,
): boolean {
  if (!isProxyEnabled(config)) return false;
  const service = config.services[serviceName];
  if (!service) return false;
  if (service.proxy === false) return false;
  const hasPort = getResolvedPort(config, serviceName) !== undefined;
  // Allow portless proxy when service explicitly opts in (port will be auto-assigned)
  if (!hasPort && !service.health && service.proxy !== true) return false;
  return true;
}

export function getServiceHostname(
  config: ResolvedConfig,
  serviceName: string,
): string {
  const pattern =
    config.proxy?.hostnamePattern ?? "{service}.{project}.localhost";
  const hostname = pattern
    .replace(/\{service\}/g, serviceName)
    .replace(/\{project\}/g, config.project);
  return parseHostname(hostname);
}

export function getServiceProxyUrl(
  config: ResolvedConfig,
  serviceName: string,
): string {
  const hostname = getServiceHostname(config, serviceName);
  return formatUrl(hostname);
}

export async function registerRoute(
  config: ResolvedConfig,
  serviceName: string,
  port: number,
  _pid?: number,
): Promise<void> {
  const hostname = getServiceHostname(config, serviceName);
  await caddy.registerRoute(hostname, port);
}

export async function deregisterRoute(
  config: ResolvedConfig,
  serviceName: string,
): Promise<void> {
  const hostname = getServiceHostname(config, serviceName);
  await caddy.deregisterRoute(hostname);
}

export async function ensureProxyRunning(
  config: ResolvedConfig,
): Promise<void> {
  if (!isProxyEnabled(config)) return;
  let available = await caddy.isAvailable();
  let attemptedStart = false;

  if (!available) {
    const startResult = await tryStartManagedProxy({
      checkAvailable: () => caddy.isAvailable(),
      getReport: () => getProxyDoctorReport(false),
    });
    available = startResult.available;
    attemptedStart = startResult.attempted;
  }

  if (!available) {
    const report = getProxyDoctorReport(available);
    const details = formatProxyDoctorReport(report)
      .map((line) => `  - ${line}`)
      .join("\n");
    const lazyStartLine = attemptedStart
      ? "DevMux tried to start the managed proxy automatically, but it is still not ready.\n"
      : "";
    throw new Error(
      `Caddy proxy is not ready.\n${lazyStartLine}${details}\n  - Docs: docs/PORTLESS_PROXY.md`,
    );
  }
}

export async function listProxyRoutes(_config: ResolvedConfig): Promise<void> {
  const routes = await caddy.listRoutes();
  if (routes.length === 0) {
    console.log("No active proxy routes.");
    return;
  }
  console.log("\nActive proxy routes:\n");
  for (const route of routes) {
    console.log(`  http://${route.hostname}  ->  localhost:${route.port}`);
  }
  console.log();
}

export async function findFreePort(
  minPort = MIN_AUTO_PORT,
  maxPort = MAX_AUTO_PORT,
): Promise<number> {
  // Sweep stale reservations once per call so they don't accumulate
  sweepExpiredReservations();

  const tryPort = (port: number): Promise<boolean> => {
    return new Promise((resolve) => {
      const server = createServer();
      server.listen(port, () => {
        server.close(() => resolve(true));
      });
      server.on("error", () => resolve(false));
    });
  };

  /**
   * Probe a candidate port: skip if reserved by another process, skip if not
   * free on the network, then atomically claim it with a reservation file.
   * Returns the reserved port or null if the port was lost to a race.
   */
  const tryReserve = async (port: number): Promise<number | null> => {
    if (isPortReserved(port)) return null;
    if (!(await tryPort(port))) return null;
    // Attempt to atomically reserve the port (fails if another process won
    // the race between our isPortReserved check and this write)
    if (!reservePort(port)) return null;
    return port;
  };

  // Random probe phase — fast path for sparse allocation
  for (let i = 0; i < RANDOM_PORT_ATTEMPTS; i++) {
    const port = minPort + Math.floor(Math.random() * (maxPort - minPort + 1));
    const reserved = await tryReserve(port);
    if (reserved !== null) return reserved;
  }

  // Sequential fallback — exhaustive scan
  for (let port = minPort; port <= maxPort; port++) {
    const reserved = await tryReserve(port);
    if (reserved !== null) return reserved;
  }

  throw new Error(`No free port found in range ${minPort}-${maxPort}`);
}
