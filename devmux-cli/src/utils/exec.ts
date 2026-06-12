import { spawn, execFileSync } from "node:child_process";

/**
 * Quote a string for safe interpolation into a POSIX shell command.
 * Wraps in single quotes; embedded single quotes become '\''.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Run a command with an argv array (no shell interpretation).
 * Returns trimmed stdout, or "" on failure.
 */
export function exec(command: string, args: string[] = []): string {
  try {
    const result = execFileSync(command, args, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.trim();
  } catch {
    return "";
  }
}

/**
 * Run a command with an argv array (no shell interpretation).
 * Returns true if it exited 0.
 */
export function execSuccess(command: string, args: string[] = []): boolean {
  try {
    execFileSync(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

export function spawnAttached(command: string, args: string[]): void {
  spawn(command, args, {
    stdio: "inherit",
  });
}
