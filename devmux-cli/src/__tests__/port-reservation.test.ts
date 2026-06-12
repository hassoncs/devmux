import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPortReserved, reservePort, releasePort, sweepExpiredReservations } from "../utils/lock.js";
import { findFreePort } from "../proxy/manager.js";

// Use a temp HOME for each test so reservation files don't cross-contaminate
let tempHome: string;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "devmux-lock-test-"));
  vi.stubEnv("HOME", tempHome);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(tempHome, { recursive: true, force: true });
});

describe("reservePort / isPortReserved / releasePort", () => {
  it("reserves a port and reports it as reserved", () => {
    const port = 4200;
    expect(isPortReserved(port)).toBe(false);
    const ok = reservePort(port);
    expect(ok).toBe(true);
    expect(isPortReserved(port)).toBe(true);
  });

  it("second reservePort call for the same port returns false (race guard)", () => {
    const port = 4201;
    expect(reservePort(port)).toBe(true);
    expect(reservePort(port)).toBe(false);
  });

  it("releasing a port makes it available again", () => {
    const port = 4202;
    reservePort(port);
    releasePort(port);
    expect(isPortReserved(port)).toBe(false);
    // Can re-reserve after release
    expect(reservePort(port)).toBe(true);
  });

  it("throws when HOME is not set", () => {
    vi.unstubAllEnvs();
    delete process.env.HOME;
    expect(() => reservePort(4203)).toThrow(/HOME/);
    // Restore for afterEach cleanup
    process.env.HOME = tempHome;
  });
});

describe("sweepExpiredReservations", () => {
  it("removes expired reservations", async () => {
    // Fake a reservation that is already expired by manipulating time
    const port = 4210;
    reservePort(port);
    expect(isPortReserved(port)).toBe(true);

    // Advance time so the reservation appears expired
    const now = Date.now();
    vi.setSystemTime(now + 60_000); // 60 seconds forward

    sweepExpiredReservations();
    // isPortReserved also cleans up expired entries
    expect(isPortReserved(port)).toBe(false);

    vi.useRealTimers();
  });
});

describe("findFreePort — no duplicate port assignment across two sequential calls", () => {
  it("returns two distinct ports for two sequential findFreePort calls", async () => {
    // Use a tiny port range so collisions would be inevitable without reservation
    const min = 4800;
    const max = 4850;

    const port1 = await findFreePort(min, max);
    // port1 is now reserved; second call must skip it
    const port2 = await findFreePort(min, max);

    expect(port1).toBeGreaterThanOrEqual(min);
    expect(port1).toBeLessThanOrEqual(max);
    expect(port2).toBeGreaterThanOrEqual(min);
    expect(port2).toBeLessThanOrEqual(max);
    expect(port1).not.toBe(port2);

    // Cleanup
    releasePort(port1);
    releasePort(port2);
  });
});
