import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RouteStore } from "../proxy/routes.js";

let tempDir: string;
let store: RouteStore;

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "devmux-test-"));
	store = new RouteStore(tempDir);
	store.ensureDir();
});

afterEach(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

describe("RouteStore", () => {
	it("starts with empty routes", () => {
		expect(store.loadRoutes()).toEqual([]);
	});

	it("adds and loads routes", () => {
		store.addRoute("app.localhost", 3000, process.pid);

		const routes = store.loadRoutes();
		expect(routes).toHaveLength(1);
		expect(routes[0].hostname).toBe("app.localhost");
		expect(routes[0].port).toBe(3000);
	});

	it("removes routes by hostname", () => {
		store.addRoute("app.localhost", 3000, process.pid);
		store.addRoute("api.localhost", 4000, process.pid);

		store.removeRoute("app.localhost");

		const routes = store.loadRoutes();
		expect(routes).toHaveLength(1);
		expect(routes[0].hostname).toBe("api.localhost");
	});

	it("overwrites duplicate hostnames", () => {
		store.addRoute("app.localhost", 3000, process.pid);
		store.addRoute("app.localhost", 4000, process.pid);

		const routes = store.loadRoutes();
		expect(routes).toHaveLength(1);
		expect(routes[0].port).toBe(4000);
	});

	it("filters out routes with dead pids", () => {
		store.addRoute("app.localhost", 3000, 999999999);

		const routes = store.loadRoutes();
		expect(routes).toHaveLength(0);
	});
});
