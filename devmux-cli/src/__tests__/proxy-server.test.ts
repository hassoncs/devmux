import { describe, it, expect, afterEach } from "vitest";
import * as http from "node:http";
import { createProxyServer } from "../proxy/server.js";
import type { RouteInfo } from "../proxy/routes.js";

let servers: http.Server[] = [];

function listenOn(server: http.Server, port: number): Promise<void> {
	return new Promise((resolve) => server.listen(port, "localhost", () => resolve()));
}

function closeAll(): Promise<void> {
	return Promise.all(
		servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
	).then(() => {
		servers = [];
	});
}

function fetch200(url: string): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		http.get(url, (res) => {
			let body = "";
			res.on("data", (d) => (body += d));
			res.on("end", () => resolve({ status: res.statusCode!, body }));
		}).on("error", reject);
	});
}

afterEach(() => closeAll());

describe("createProxyServer", () => {
	it("proxies traffic to a backend by hostname", async () => {
		const backend = http.createServer((_req, res) => {
			res.writeHead(200, { "Content-Type": "text/plain" });
			res.end("hello from backend");
		});
		servers.push(backend);
		await listenOn(backend, 0);
		const backendPort = (backend.address() as { port: number }).port;

		const routes: RouteInfo[] = [
			{ hostname: "test.app.localhost", port: backendPort, pid: process.pid },
		];

		const proxy = createProxyServer({
			getRoutes: () => routes,
			proxyPort: 0,
		});
		servers.push(proxy);
		await listenOn(proxy, 0);
		const proxyPort = (proxy.address() as { port: number }).port;

		const noHostMatch = await fetch200(`http://localhost:${proxyPort}/`);
		expect(noHostMatch.status).toBe(404);

		const withHostMatch = await new Promise<{ status: number; body: string }>((resolve, reject) => {
			http.get(
				{
					hostname: "localhost",
					port: proxyPort,
					path: "/",
					headers: { Host: `test.app.localhost:${proxyPort}` },
				},
				(res) => {
					let body = "";
					res.on("data", (d) => (body += d));
					res.on("end", () => resolve({ status: res.statusCode!, body }));
				},
			).on("error", reject);
		});

		expect(withHostMatch.status).toBe(200);
		expect(withHostMatch.body).toBe("hello from backend");
	});

	it("returns 502 when backend is down", async () => {
		const routes: RouteInfo[] = [
			{ hostname: "dead.app.localhost", port: 19998, pid: process.pid },
		];

		const proxy = createProxyServer({
			getRoutes: () => routes,
			proxyPort: 0,
			onError: () => {},
		});
		servers.push(proxy);
		await listenOn(proxy, 0);
		const proxyPort = (proxy.address() as { port: number }).port;

		const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
			http.get(
				{
					hostname: "localhost",
					port: proxyPort,
					path: "/",
					headers: { Host: `dead.app.localhost:${proxyPort}` },
				},
				(res) => {
					let body = "";
					res.on("data", (d) => (body += d));
					res.on("end", () => resolve({ status: res.statusCode!, body }));
				},
			).on("error", reject);
		});

		expect(result.status).toBe(502);
	});

	it("returns 404 for unknown hostname", async () => {
		const proxy = createProxyServer({
			getRoutes: () => [],
			proxyPort: 0,
		});
		servers.push(proxy);
		await listenOn(proxy, 0);
		const proxyPort = (proxy.address() as { port: number }).port;

		const result = await new Promise<{ status: number }>((resolve, reject) => {
			http.get(
				{
					hostname: "localhost",
					port: proxyPort,
					path: "/",
					headers: { Host: `unknown.localhost:${proxyPort}` },
				},
				(res) => {
					res.resume();
					res.on("end", () => resolve({ status: res.statusCode! }));
				},
			).on("error", reject);
		});

		expect(result.status).toBe(404);
	});
});
