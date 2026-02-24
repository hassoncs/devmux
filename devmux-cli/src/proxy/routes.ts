import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const STALE_LOCK_THRESHOLD_MS = 10_000;
const LOCK_MAX_RETRIES = 20;
const LOCK_RETRY_DELAY_MS = 50;
const FILE_MODE = 0o644;
const DIR_MODE = 0o755;

export interface RouteInfo {
	hostname: string;
	port: number;
	pid: number;
}

function isValidRoute(value: unknown): value is RouteInfo {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as RouteInfo).hostname === "string" &&
		typeof (value as RouteInfo).port === "number" &&
		typeof (value as RouteInfo).pid === "number"
	);
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function syncSleep(ms: number): void {
	const buf = new Int32Array(new SharedArrayBuffer(4));
	Atomics.wait(buf, 0, 0, ms);
}

export class RouteStore {
	private routesPath: string;
	private lockPath: string;

	constructor(public readonly dir: string) {
		this.routesPath = join(dir, "routes.json");
		this.lockPath = join(dir, "routes.lock");
	}

	ensureDir(): void {
		if (!existsSync(this.dir)) {
			mkdirSync(this.dir, { recursive: true, mode: DIR_MODE });
		}
	}

	getRoutesPath(): string {
		return this.routesPath;
	}

	private acquireLock(): boolean {
		for (let i = 0; i < LOCK_MAX_RETRIES; i++) {
			try {
				mkdirSync(this.lockPath);
				return true;
			} catch (err: unknown) {
				const code = (err as NodeJS.ErrnoException).code;
				if (code === "EEXIST") {
					try {
						const stat = statSync(this.lockPath);
						if (Date.now() - stat.mtimeMs > STALE_LOCK_THRESHOLD_MS) {
							rmSync(this.lockPath, { recursive: true });
							continue;
						}
					} catch {
						continue;
					}
					syncSleep(LOCK_RETRY_DELAY_MS);
				} else {
					return false;
				}
			}
		}
		return false;
	}

	private releaseLock(): void {
		try {
			rmSync(this.lockPath, { recursive: true });
		} catch {}
	}

	loadRoutes(persistCleanup = false): RouteInfo[] {
		if (!existsSync(this.routesPath)) return [];

		try {
			const raw = readFileSync(this.routesPath, "utf-8");
			let parsed: unknown;
			try {
				parsed = JSON.parse(raw);
			} catch {
				return [];
			}
			if (!Array.isArray(parsed)) return [];

			const routes = parsed.filter(isValidRoute);
			const alive = routes.filter((r) => isProcessAlive(r.pid));

			if (persistCleanup && alive.length !== routes.length) {
				try {
					writeFileSync(this.routesPath, JSON.stringify(alive, null, 2), { mode: FILE_MODE });
				} catch {}
			}
			return alive;
		} catch {
			return [];
		}
	}

	addRoute(hostname: string, port: number, pid: number): void {
		this.ensureDir();
		if (!this.acquireLock()) throw new Error("Failed to acquire route lock");
		try {
			const routes = this.loadRoutes(true).filter((r) => r.hostname !== hostname);
			routes.push({ hostname, port, pid });
			writeFileSync(this.routesPath, JSON.stringify(routes, null, 2), { mode: FILE_MODE });
		} finally {
			this.releaseLock();
		}
	}

	removeRoute(hostname: string): void {
		this.ensureDir();
		if (!this.acquireLock()) throw new Error("Failed to acquire route lock");
		try {
			const routes = this.loadRoutes(true).filter((r) => r.hostname !== hostname);
			writeFileSync(this.routesPath, JSON.stringify(routes, null, 2), { mode: FILE_MODE });
		} finally {
			this.releaseLock();
		}
	}
}
