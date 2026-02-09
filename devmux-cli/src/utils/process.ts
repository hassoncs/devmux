import fkill from "fkill";
import psList from "ps-list";
import { execSync } from "node:child_process";

export interface ProcessInfo {
  pid: number;
  name: string;
  cmd?: string;
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

export async function getProcessInfo(pid: number): Promise<ProcessInfo | null> {
  try {
    const processes = await psList();
    const proc = processes.find((p) => p.pid === pid);
    if (!proc) return null;

    return {
      pid: proc.pid,
      name: proc.name,
      cmd: proc.cmd,
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
