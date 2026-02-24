// Detached daemon process — spawned by startProxyDaemon() in manager.ts
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createProxyServer } from "./server.js";
import { RouteStore } from "./routes.js";

const proxyPort = parseInt(process.argv[2] ?? "1355", 10);
const stateDir = process.argv[3] ?? join(homedir(), ".portless");

const store = new RouteStore(stateDir);
store.ensureDir();

const routesPath = store.getRoutesPath();
if (!existsSync(routesPath)) {
	writeFileSync(routesPath, "[]");
}

const pidPath = join(stateDir, "proxy.pid");
const portFilePath = join(stateDir, "proxy.port");

const server = createProxyServer({
	getRoutes: () => store.loadRoutes(),
	proxyPort,
});

server.listen(proxyPort, () => {
	writeFileSync(pidPath, process.pid.toString());
	writeFileSync(portFilePath, proxyPort.toString());
});

function cleanup() {
	try { unlinkSync(pidPath); } catch {}
	try { unlinkSync(portFilePath); } catch {}
	server.close();
}

process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("SIGTERM", () => { cleanup(); process.exit(0); });
process.on("exit", cleanup);
