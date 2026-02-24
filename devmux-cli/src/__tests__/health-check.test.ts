import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:net";
import { checkPort } from "../health/checkers.js";

let servers: Server[] = [];

function listen(server: Server, port: number, host: string): Promise<void> {
	return new Promise((resolve) => {
		server.listen(port, host, () => resolve());
	});
}

function closeAll(): Promise<void> {
	return Promise.all(
		servers.map(
			(s) => new Promise<void>((resolve) => s.close(() => resolve())),
		),
	).then(() => {
		servers = [];
	});
}

afterEach(() => closeAll());

describe("checkPort", () => {
	it("detects a server on IPv4", async () => {
		const server = createServer();
		servers.push(server);
		await listen(server, 0, "127.0.0.1");
		const port = (server.address() as { port: number }).port;

		expect(await checkPort(port, "127.0.0.1")).toBe(true);
	});

	it("detects a server on IPv6", async () => {
		const server = createServer();
		servers.push(server);
		await listen(server, 0, "::1");
		const port = (server.address() as { port: number }).port;

		expect(await checkPort(port, "::1")).toBe(true);
	});

	it("detects a server via localhost (default)", async () => {
		const server = createServer();
		servers.push(server);
		await listen(server, 0, "localhost");
		const port = (server.address() as { port: number }).port;

		expect(await checkPort(port)).toBe(true);
	});

	it("returns false for a port with nothing listening", async () => {
		expect(await checkPort(19999)).toBe(false);
	});
});
