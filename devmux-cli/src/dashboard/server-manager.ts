import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const PID_DIR = join(process.env.HOME ?? "~", ".opencode");
const PID_FILE = join(PID_DIR, "dashboard-server.pid");

export interface DashboardServerStatus {
	running: boolean;
	pid?: number;
	port?: number;
}

interface PidData {
	pid: number;
	port: number;
}

function readPidData(): PidData | null {
	if (!existsSync(PID_FILE)) return null;

	try {
		const raw = readFileSync(PID_FILE, "utf-8").trim();
		const parsed = JSON.parse(raw);
		const pid = parsed.pid;
		const port = parsed.port;
		if (typeof pid !== "number" || isNaN(pid)) return null;

		try {
			process.kill(pid, 0);
			return { pid, port };
		} catch {
			unlinkSync(PID_FILE);
			return null;
		}
	} catch {
		try { unlinkSync(PID_FILE); } catch {}
		return null;
	}
}

export function saveDashboardPid(pid: number, port: number): void {
	if (!existsSync(PID_DIR)) {
		mkdirSync(PID_DIR, { recursive: true });
	}
	writeFileSync(PID_FILE, JSON.stringify({ pid, port }));
}

export function clearDashboardPid(): void {
	if (existsSync(PID_FILE)) {
		try { unlinkSync(PID_FILE); } catch {}
	}
}

export function getDashboardStatus(): DashboardServerStatus {
	const data = readPidData();

	if (!data) {
		return { running: false };
	}

	return {
		running: true,
		pid: data.pid,
		port: data.port,
	};
}

export function stopDashboardServer(): boolean {
	const data = readPidData();

	if (!data) {
		console.log("Dashboard is not running");
		return false;
	}

	try {
		process.kill(data.pid, "SIGTERM");
		clearDashboardPid();
		console.log(`Dashboard stopped (PID: ${data.pid})`);
		return true;
	} catch (error) {
		clearDashboardPid();
		console.error("Failed to stop dashboard:", error);
		return false;
	}
}
