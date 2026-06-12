import { execFileSync, spawnSync, spawn } from "node:child_process";
import { shellQuote } from "../utils/exec.js";

let tmuxChecked = false;

/**
 * Fail fast with a clear message when tmux is missing instead of letting
 * every subsequent call silently no-op (which used to surface as a 30s
 * startup-timeout hang).
 */
export function ensureTmuxAvailable(): void {
  if (tmuxChecked) return;
  try {
    execFileSync("tmux", ["-V"], { stdio: ["pipe", "pipe", "pipe"] });
    tmuxChecked = true;
  } catch {
    throw new Error(
      "tmux is not installed or not on PATH.\n" +
        "  macOS: brew install tmux\n" +
        "  Debian/Ubuntu: apt install tmux",
    );
  }
}

export function hasSession(sessionName: string): boolean {
  try {
    execFileSync("tmux", ["has-session", "-t", sessionName], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

export function listSessions(prefix?: string): string[] {
  try {
    const output = execFileSync(
      "tmux",
      ["list-sessions", "-F", "#{session_name}"],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
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
  ensureTmuxAvailable();

  const created = spawnSync(
    "tmux",
    ["new-session", "-d", "-s", sessionName, "-c", cwd],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  if (created.error) {
    throw new Error(`Failed to start tmux session ${sessionName}: ${created.error.message}`);
  }
  if (created.status !== 0) {
    const stderr = created.stderr?.toString().trim();
    throw new Error(
      `Failed to start tmux session ${sessionName}${stderr ? `: ${stderr}` : ""}`,
    );
  }

  // Prepend env vars inline so they survive direnv reloads and are guaranteed
  // to reach the command process. tmux new-session -e only sets vars on the
  // initial shell; send-keys runs after direnv fires and those vars are lost.
  // Values are shell-quoted: they originate from config and templating and
  // must not be interpretable by the session shell.
  const envPrefix = env
    ? Object.entries(env)
        .map(([k, v]) => `${k}=${shellQuote(v)}`)
        .join(" ") + " "
    : "";

  const sent = spawnSync(
    "tmux",
    ["send-keys", "-t", sessionName, `${envPrefix}${command}`, "Enter"],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  if (sent.error || sent.status !== 0) {
    throw new Error(`Failed to send command to tmux session ${sessionName}`);
  }
}

export function setRemainOnExit(sessionName: string, value: boolean): void {
  try {
    execFileSync(
      "tmux",
      ["set-option", "-t", sessionName, "remain-on-exit", value ? "on" : "off"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
  } catch {}
}

export function killSession(sessionName: string): void {
  try {
    execFileSync("tmux", ["kill-session", "-t", sessionName], {
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
