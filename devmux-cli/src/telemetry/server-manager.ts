import { spawn, execSync, ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const PID_FILE = join(process.env.HOME ?? "~", ".opencode", "telemetry-server.pid");
const DEFAULT_PORT = 9876;
const DEFAULT_HOST = "0.0.0.0";

export interface ServerStatus {
  running: boolean;
  pid?: number;
  port?: number;
  host?: string;
}

function getPid(): number | null {
  if (!existsSync(PID_FILE)) return null;

  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
    if (isNaN(pid)) return null;

    try {
      process.kill(pid, 0);
      return pid;
    } catch {
      unlinkSync(PID_FILE);
      return null;
    }
  } catch {
    return null;
  }
}

function savePid(pid: number): void {
  const dir = join(process.env.HOME ?? "~", ".opencode");
  if (!existsSync(dir)) {
    execSync(`mkdir -p "${dir}"`);
  }
  writeFileSync(PID_FILE, String(pid));
}

function clearPid(): void {
  if (existsSync(PID_FILE)) {
    unlinkSync(PID_FILE);
  }
}

export function getServerStatus(): ServerStatus {
  const pid = getPid();

  if (!pid) {
    return { running: false };
  }

  return {
    running: true,
    pid,
    port: DEFAULT_PORT,
    host: DEFAULT_HOST,
  };
}

export function startServer(options: { port?: number; host?: string } = {}): boolean {
  const existingPid = getPid();
  if (existingPid) {
    console.log(`Telemetry server already running (PID: ${existingPid})`);
    return false;
  }

  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? DEFAULT_HOST;

  const serverScript = `
const { createServer } = require('@chriscode/devmux-telemetry-server');
const server = createServer({ port: ${port}, host: '${host}' });
server.start().then(() => {
  console.log('Telemetry server started');
}).catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
process.on('SIGTERM', () => {
  server.stop().then(() => process.exit(0));
});
process.on('SIGINT', () => {
  server.stop().then(() => process.exit(0));
});
`;

  try {
    const child = spawn("node", ["-e", serverScript], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      cwd: process.cwd(),
    });

    if (child.pid) {
      savePid(child.pid);
      child.unref();
      console.log(`Telemetry server started (PID: ${child.pid})`);
      console.log(`Listening on ws://${host}:${port}`);
      return true;
    }

    return false;
  } catch (error) {
    console.error("Failed to start server:", error);
    return false;
  }
}

export function stopServer(): boolean {
  const pid = getPid();

  if (!pid) {
    console.log("Telemetry server is not running");
    return false;
  }

  try {
    process.kill(pid, "SIGTERM");
    clearPid();
    console.log(`Telemetry server stopped (PID: ${pid})`);
    return true;
  } catch (error) {
    clearPid();
    console.error("Failed to stop server:", error);
    return false;
  }
}
