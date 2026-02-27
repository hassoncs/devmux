import { execSync, spawnSync, spawn } from "node:child_process";

export function hasSession(sessionName: string): boolean {
  try {
    execSync(`tmux has-session -t ${sessionName}`, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

export function listSessions(prefix?: string): string[] {
  try {
    const output = execSync("tmux list-sessions -F #{session_name}", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const sessions = output.trim().split("\n").filter(Boolean);
    if (prefix) {
      return sessions.filter((s) => s.startsWith(prefix));
    }
    return sessions;
  } catch {
    return [];
  }
}

export function newSession(
  sessionName: string,
  cwd: string,
  command: string,
  env?: Record<string, string>
): void {
  const envArgs = env
    ? Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`])
    : [];

  spawnSync("tmux", ["new-session", "-d", "-s", sessionName, "-c", cwd, ...envArgs], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  // send-keys avoids shell quoting issues — command content is never interpreted by a shell
  spawnSync("tmux", ["send-keys", "-t", sessionName, command, "Enter"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export function setRemainOnExit(sessionName: string, value: boolean): void {
  try {
    execSync(
      `tmux set-option -t "${sessionName}" remain-on-exit ${value ? "on" : "off"}`,
      { stdio: ["pipe", "pipe", "pipe"] }
    );
  } catch {}
}

export function killSession(sessionName: string): void {
  try {
    execSync(`tmux kill-session -t "${sessionName}"`, {
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {}
}

export function attachSession(sessionName: string): void {
  const child = spawn("tmux", ["attach", "-t", sessionName], {
    stdio: "inherit",
  });
  child.on("error", () => {});
}
