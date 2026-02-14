import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { loadConfig } from "../config/loader.js";
import type { ResolvedConfig, ServiceStatus } from "../config/types.js";
import { getAllStatus } from "../core/service.js";
import {
	type DashboardData,
	type DashboardService,
	renderDashboard,
} from "./template.js";

function getConfigPath(config: ResolvedConfig): string {
	const names = ["devmux.config.json", ".devmuxrc.json", ".devmuxrc"];
	for (const name of names) {
		const path = `${config.configRoot}/${name}`;
		if (existsSync(path)) return path;
	}
	return `${config.configRoot}/devmux.config.json`;
}

function statusToService(
	s: ServiceStatus,
	config: ResolvedConfig,
): DashboardService | null {
	const def = config.services[s.name];

	// Dashboard visibility logic:
	// - dashboard: true → always show
	// - dashboard: false → never show
	// - unset → show if service has a port
	if (def?.dashboard === false) return null;
	if (def?.dashboard !== true && !s.port && !s.resolvedPort) return null;

	return {
		name: s.name,
		healthy: s.healthy,
		port: s.port,
		resolvedPort: s.resolvedPort,
		hasHealthCheck: def?.health !== undefined,
	};
}

function openBrowser(url: string): void {
	const command =
		process.platform === "darwin"
			? `open "${url}"`
			: process.platform === "win32"
				? `cmd /c start "${url}"`
				: `xdg-open "${url}"`;

	exec(command, () => {});
}

export interface DashboardOptions {
	port?: number;
	open?: boolean;
}

export interface DashboardResult {
	server: Server;
	port: number;
}

const MAX_PORT_RETRIES = 10;

function tryListen(server: Server, port: number, maxRetries: number): Promise<number> {
	return new Promise((resolve, reject) => {
		let attempt = 0;

		const onError = (err: NodeJS.ErrnoException) => {
			if (err.code === "EADDRINUSE" && attempt < maxRetries) {
				attempt++;
				server.listen(port + attempt);
			} else {
				server.removeListener("error", onError);
				reject(err);
			}
		};

		server.on("error", onError);
		server.once("listening", () => {
			server.removeListener("error", onError);
			resolve(port + attempt);
		});

		server.listen(port);
	});
}

export async function startDashboard(options: DashboardOptions = {}): Promise<DashboardResult> {
	const basePort = options.port ?? 9000;
	const shouldOpen = options.open ?? true;
	const config = loadConfig();
	const configPath = getConfigPath(config);

	let actualPort = basePort;

	const server = createServer(async (req, res) => {
		if (req.url === "/api/status") {
			try {
				const statuses = await getAllStatus(config);
				const services = statuses
					.map((s) => statusToService(s, config))
					.filter((s): s is DashboardService => s !== null);
				const payload = {
					project: config.project,
					instanceId: config.instanceId || null,
					configPath,
					services,
				};
				res.writeHead(200, {
					"Content-Type": "application/json",
					"Cache-Control": "no-cache",
				});
				res.end(JSON.stringify(payload));
			} catch (err) {
				res.writeHead(500, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Failed to fetch status" }));
			}
			return;
		}

		if (req.url === "/" || req.url === "/index.html") {
			try {
				const statuses = await getAllStatus(config);
				const services = statuses
					.map((s) => statusToService(s, config))
					.filter((s): s is DashboardService => s !== null);
				const data: DashboardData = {
					project: config.project,
					instanceId: config.instanceId || "",
					configPath,
					dashboardPort: actualPort,
					services,
				};
				res.writeHead(200, {
					"Content-Type": "text/html; charset=utf-8",
					"Cache-Control": "no-cache",
				});
				res.end(renderDashboard(data));
			} catch (err) {
				res.writeHead(500, { "Content-Type": "text/plain" });
				res.end("Failed to render dashboard");
			}
			return;
		}

		res.writeHead(404, { "Content-Type": "text/plain" });
		res.end("Not Found");
	});

	actualPort = await tryListen(server, basePort, MAX_PORT_RETRIES);

	const url = `http://localhost:${actualPort}`;
	console.log(`devmux dashboard running at ${url}`);
	if (actualPort !== basePort) {
		console.log(`  (port ${basePort} was in use, using ${actualPort})`);
	}
	console.log(`  Project: ${config.project}`);
	console.log(`  Config:  ${configPath}`);
	console.log("");
	console.log("Press Ctrl+C to stop.");

	if (shouldOpen) {
		openBrowser(url);
	}

	return { server, port: actualPort };
}
