import { describe, it, expect } from "vitest";
import { getProcessCwd } from "../utils/process.js";

describe("getProcessCwd", () => {
  it("returns the cwd for the current process", () => {
    const cwd = getProcessCwd(process.pid);
    expect(cwd).toBeTruthy();
    expect(typeof cwd).toBe("string");
  });

  it("returns null for a non-existent PID", () => {
    const cwd = getProcessCwd(999999);
    expect(cwd).toBeNull();
  });
});
