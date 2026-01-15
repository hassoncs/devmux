import { mkdirSync, rmdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function acquireLock(name: string): boolean {
  const lockDir = join(tmpdir(), `${name}.lock`);
  try {
    mkdirSync(lockDir);
    return true;
  } catch {
    return false;
  }
}

export function releaseLock(name: string): void {
  const lockDir = join(tmpdir(), `${name}.lock`);
  try {
    rmdirSync(lockDir);
  } catch {}
}

export function isLocked(name: string): boolean {
  const lockDir = join(tmpdir(), `${name}.lock`);
  return existsSync(lockDir);
}
