import fkill from "fkill";
import psList from "ps-list";
import { execSync } from "node:child_process";
import { existsSync, readlinkSync } from "node:fs";
import { resolve } from "node:path";

export interface ProcessInfo {
  pid: number;
  name: string;
  cmd?: string;
  cwd?: string;
}

export async function getProcessOnPort(port: number): Promise<ProcessInfo | null> {
  try {
    if (process.platform === "win32") {
      const output = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf-8" });
      const lines = output.trim().split("\n");
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5) {
          const pid = parseInt(parts[4], 10);
          if (!isNaN(pid)) {
            const proc = await getProcessInfo(pid);
            if (proc) return proc;
          }
        }
      }
      return null;
    }

    const output = execSync(`lsof -ti :${port}`, { encoding: "utf-8" }).trim();
    if (!output) return null;

    const pid = parseInt(output.split("\n")[0], 10);
    if (isNaN(pid)) return null;

    return await getProcessInfo(pid);
  } catch {
    return null;
  }
}

export function getProcessCwd(pid: number): string | null {
  try {
    if (process.platform === "linux") {
      const linkPath = `/proc/${pid}/cwd`;
      if (existsSync(linkPath)) {
        return readlinkSync(linkPath);
      }
    }

    const output = execSync(`lsof -p ${pid} 2>/dev/null | grep cwd`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    const line = output.trim().split("\n")[0];
    if (!line) return null;

    // lsof cwd format: COMMAND PID USER cwd DIR device size node /path/to/dir
    const match = line.match(/\s+cwd\s+\S+\s+\S+\s+\S+\s+\S+\s+(.*)/);
    if (match) {
      return resolve(match[1].trim());
    }

    const parts = line.trim().split(/\s+/);
    const lastPart = parts[parts.length - 1];
    if (lastPart && lastPart.startsWith("/")) {
      return resolve(lastPart);
    }

    return null;
  } catch {
    return null;
  }
}

export async function getProcessInfo(pid: number): Promise<ProcessInfo | null> {
  try {
    const processes = await psList();
    const proc = processes.find((p) => p.pid === pid);
    if (!proc) return null;

    return {
      pid: proc.pid,
      name: proc.name,
      cmd: proc.cmd,
      cwd: getProcessCwd(proc.pid) ?? undefined,
    };
  } catch {
    return null;
  }
}

export async function killProcess(pid: number): Promise<void> {
  try {
    await fkill(pid, { force: true });
  } catch {}
}

export async function getProcessesOnPort(port: number): Promise<ProcessInfo[]> {
  const processes: ProcessInfo[] = [];

  try {
    if (process.platform === "win32") {
      const output = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf-8" });
      const lines = output.trim().split("\n");
      const seenPids = new Set<number>();

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5) {
          const pid = parseInt(parts[4], 10);
          if (!isNaN(pid) && !seenPids.has(pid)) {
            seenPids.add(pid);
            const proc = await getProcessInfo(pid);
            if (proc) processes.push(proc);
          }
        }
      }
    } else {
      const output = execSync(`lsof -ti :${port}`, { encoding: "utf-8" }).trim();
      if (output) {
        const pids = output.split("\n").map((p) => parseInt(p, 10)).filter((p) => !isNaN(p));
        const uniquePids = [...new Set(pids)];

        for (const pid of uniquePids) {
          const proc = await getProcessInfo(pid);
          if (proc) processes.push(proc);
        }
      }
    }
  } catch {}

  return processes;
}
