/**
 * Port reservation lock — prevents TOCTOU races when two concurrent `ensure`
 * calls both probe the same range and pick the same free port.
 *
 * Strategy: after finding a free port, write a reservation file to
 * ~/.devmux/port-reservations/<port> with a short TTL.  Concurrent callers
 * skip any port that has a live reservation.  The reservation is released
 * explicitly (or automatically expires after TTL_MS on the next reservation
 * sweep, so crashed processes don't leave ports permanently blocked).
 *
 * State directory: ~/.devmux  (0700)
 * Reservation files: ~/.devmux/port-reservations/<port>  (0600)
 * Format: newline-terminated JSON  { pid: number, expires: number }
 */

import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const TTL_MS = 30_000; // 30 seconds — long enough to cover service startup

function devmuxStateDir(): string {
  const home = process.env.HOME;
  if (!home) {
    throw new Error(
      "process.env.HOME is not set — devmux cannot determine state directory for port reservations"
    );
  }
  return join(home, ".devmux");
}

function reservationsDir(): string {
  return join(devmuxStateDir(), "port-reservations");
}

function reservationPath(port: number): string {
  return join(reservationsDir(), String(port));
}

interface ReservationRecord {
  pid: number;
  expires: number;
}

function ensureReservationsDir(): void {
  const dir = reservationsDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/** Returns true when a valid (non-expired) reservation exists for this port. */
export function isPortReserved(port: number): boolean {
  const path = reservationPath(port);
  if (!existsSync(path)) return false;
  try {
    const record: ReservationRecord = JSON.parse(readFileSync(path, "utf-8"));
    if (Date.now() < record.expires) return true;
    // Expired — clean up opportunistically
    unlinkSync(path);
    return false;
  } catch {
    // Corrupt or unreadable — treat as not reserved
    return false;
  }
}

/**
 * Reserve a port.  Returns true on success, false if already reserved by
 * another process (caller should try a different port).
 */
export function reservePort(port: number): boolean {
  ensureReservationsDir();
  const path = reservationPath(port);

  // Check for an existing reservation before attempting the exclusive write.
  // The actual exclusivity is enforced by the "wx" flag below (EEXIST on race).
  if (isPortReserved(port)) return false;

  try {
    const record: ReservationRecord = {
      pid: process.pid,
      expires: Date.now() + TTL_MS,
    };
    writeFileSync(path, JSON.stringify(record) + "\n", { mode: 0o600, flag: "wx" });
    return true;
  } catch (err: unknown) {
    // EEXIST means another process just created the file — race lost
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
}

/** Release a port reservation created by this process. */
export function releasePort(port: number): void {
  const path = reservationPath(port);
  try {
    unlinkSync(path);
  } catch {
    // Already gone — that's fine
  }
}

/** Sweep and remove all expired reservation files. */
export function sweepExpiredReservations(): void {
  const dir = reservationsDir();
  if (!existsSync(dir)) return;
  try {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      try {
        const record: ReservationRecord = JSON.parse(readFileSync(path, "utf-8"));
        if (Date.now() >= record.expires) unlinkSync(path);
      } catch {
        // Corrupt file — remove it
        try { unlinkSync(path); } catch { /* ignore */ }
      }
    }
  } catch {
    // Dir disappeared between existsSync and readdirSync — ignore
  }
}
