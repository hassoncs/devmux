import { existsSync, readFileSync, unlinkSync, mkdirSync, openSync, closeSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { createServer, createConnection } from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { RouteStore, parseHostname, formatUrl } from "portless";
import type { ResolvedConfig } from "../config/types.js";
import { getResolvedPort } from "../config/loader.js";

const DEFAULT_PROXY_PORT = 1355;
const MIN_AUTO_PORT = 4000;
const MAX_AUTO_PORT = 4999;
const RANDOM_PORT_ATTEMPTS = 50;
const DAEMON_START_TIMEOUT_MS = 5000;
const DAEMON_POLL_INTERVAL_MS = 150;

function getStateDir(proxyPort: number): string {
	if (process.env.PORTLESS_STATE_DIR) return process.env.PORTLESS_STATE_DIR;
	return proxyPort < 1024 ? "/tmp/portless" : join(homedir(), ".portless");
}

function getPidPath(stateDir: string): string {
	return join(stateDir, "proxy.pid");
}

function getPortFilePath(stateDir: string): string {
	return join(stateDir, "proxy.port");
}

function ensureStateDir(stateDir: string): void {
	if (!existsSync(stateDir)) {
		mkdirSync(stateDir, { recursive: true });
	}
}

export function getProxyPort(config: ResolvedConfig): number {
	return config.proxy?.port ?? DEFAULT_PROXY_PORT;
}

export function isProxyEnabled(config: ResolvedConfig): boolean {
	return config.proxy?.enabled === true;
}

export function isServiceProxied(config: ResolvedConfig, serviceName: string): boolean {
	if (!isProxyEnabled(config)) return false;
	const service = config.services[serviceName];
	if (!service) return false;
	if (service.proxy === false) return false;
	const hasPort = getResolvedPort(config, serviceName) !== undefined;
	if (!hasPort && !service.health) return false;
	return true;
}

export function getServiceHostname(config: ResolvedConfig, serviceName: string): string {
	const pattern = config.proxy?.hostnamePattern ?? "{service}.{project}.localhost";
	const hostname = pattern
		.replace(/\{service\}/g, serviceName)
		.replace(/\{project\}/g, config.project);
	return parseHostname(hostname);
}

export function getServiceProxyUrl(config: ResolvedConfig, serviceName: string): string {
	const hostname = getServiceHostname(config, serviceName);
	const proxyPort = getProxyPort(config);
	return formatUrl(hostname, proxyPort);
}

export function getRouteStore(config: ResolvedConfig): RouteStore {
	const proxyPort = getProxyPort(config);
	const stateDir = getStateDir(proxyPort);
	return new RouteStore(stateDir);
}

export function registerRoute(
	config: ResolvedConfig,
	serviceName: string,
	port: number,
	pid: number,
): void {
	const store = getRouteStore(config);
	const hostname = getServiceHostname(config, serviceName);
	store.addRoute(hostname, port, pid);
}

export function deregisterRoute(config: ResolvedConfig, serviceName: string): void {
	const store = getRouteStore(config);
	const hostname = getServiceHostname(config, serviceName);
	store.removeRoute(hostname);
}

export function getProxyStatus(config: ResolvedConfig): {
	running: boolean;
	pid: number | null;
	port: number;
} {
	const proxyPort = getProxyPort(config);
	const stateDir = getStateDir(proxyPort);
	const pidPath = getPidPath(stateDir);

	if (!existsSync(pidPath)) {
		return { running: false, pid: null, port: proxyPort };
	}

	try {
		const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
		if (isNaN(pid)) {
			return { running: false, pid: null, port: proxyPort };
		}

		process.kill(pid, 0);
		return { running: true, pid, port: proxyPort };
	} catch {
		try { unlinkSync(pidPath); } catch {}
		return { running: false, pid: null, port: proxyPort };
	}
}

function isPortListening(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ port, host: "127.0.0.1" });
		socket.setTimeout(500);
		socket.on("connect", () => { socket.destroy(); resolve(true); });
		socket.on("timeout", () => { socket.destroy(); resolve(false); });
		socket.on("error", () => { socket.destroy(); resolve(false); });
	});
}

function getDaemonScript(): string {
	const thisFile = fileURLToPath(import.meta.url);
	return join(dirname(thisFile), "proxy", "daemon.js");
}

export async function startProxyDaemon(config: ResolvedConfig): Promise<void> {
	const proxyPort = getProxyPort(config);
	if (await isPortListening(proxyPort)) return;

	const stateDir = getStateDir(proxyPort);
	ensureStateDir(stateDir);

	const logPath = join(stateDir, "proxy.log");
	const logFd = openSync(logPath, "a");
	try {
		const child = spawn(process.execPath, [getDaemonScript(), String(proxyPort), stateDir], {
			detached: true,
			stdio: ["ignore", logFd, logFd],
		});
		child.unref();
	} finally {
		closeSync(logFd);
	}

	const deadline = Date.now() + DAEMON_START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (await isPortListening(proxyPort)) return;
		await new Promise((r) => setTimeout(r, DAEMON_POLL_INTERVAL_MS));
	}

	throw new Error(
		`Proxy failed to start on port ${proxyPort}. Check logs: ${logPath}`,
	);
}

export async function ensureProxyRunning(config: ResolvedConfig): Promise<void> {
	if (!isProxyEnabled(config)) return;
	await startProxyDaemon(config);
}

export function stopProxy(config: ResolvedConfig): void {
	const status = getProxyStatus(config);
	if (!status.running || !status.pid) {
		console.log("Proxy is not running.");
		return;
	}

	try {
		process.kill(status.pid, "SIGTERM");
		const stateDir = getStateDir(status.port);
		try { unlinkSync(getPidPath(stateDir)); } catch {}
		try { unlinkSync(getPortFilePath(stateDir)); } catch {}
		console.log("Proxy stopped.");
	} catch (err) {
		console.error(`Failed to stop proxy: ${err instanceof Error ? err.message : err}`);
	}
}

export async function findFreePort(
	minPort = MIN_AUTO_PORT,
	maxPort = MAX_AUTO_PORT,
): Promise<number> {
	const tryPort = (port: number): Promise<boolean> => {
		return new Promise((resolve) => {
			const server = createServer();
			server.listen(port, () => {
				server.close(() => resolve(true));
			});
			server.on("error", () => resolve(false));
		});
	};

	for (let i = 0; i < RANDOM_PORT_ATTEMPTS; i++) {
		const port = minPort + Math.floor(Math.random() * (maxPort - minPort + 1));
		if (await tryPort(port)) return port;
	}

	for (let port = minPort; port <= maxPort; port++) {
		if (await tryPort(port)) return port;
	}

	throw new Error(`No free port found in range ${minPort}-${maxPort}`);
}

export function listProxyRoutes(config: ResolvedConfig): void {
	const store = getRouteStore(config);
	const routes = store.loadRoutes();
	const proxyPort = getProxyPort(config);

	if (routes.length === 0) {
		console.log("No active proxy routes.");
		return;
	}

	console.log("\nActive proxy routes:\n");
	for (const route of routes) {
		const url = formatUrl(route.hostname, proxyPort);
		console.log(`  ${url}  ->  localhost:${route.port}  (pid ${route.pid})`);
	}
	console.log();
}
