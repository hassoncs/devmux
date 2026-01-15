import { spawn, execSync } from "node:child_process";

export function exec(command: string, args: string[] = []): string {
  try {
    const result = execSync(`${command} ${args.join(" ")}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.trim();
  } catch {
    return "";
  }
}

export function execSuccess(command: string, args: string[] = []): boolean {
  try {
    execSync(`${command} ${args.join(" ")}`, {
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
