import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfigExact } from "../config/loader.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeConfig(config: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "devmux-loader-"));
  tempDirs.push(dir);
  writeFileSync(
    join(dir, "devmux.config.json"),
    JSON.stringify(config, null, 2),
    "utf8",
  );
  return dir;
}

describe("loadConfigExact", () => {
  it("rejects non-localhost proxy hostname patterns", () => {
    const dir = writeConfig({
      version: 1,
      project: "fitbot",
      proxy: {
        enabled: true,
        hostnamePattern: "{service}.{project}.town.lan",
      },
      services: {
        web: { cwd: ".", command: "pnpm dev" },
      },
    });

    expect(() => loadConfigExact(dir)).toThrow(
      "proxy.hostnamePattern must resolve to a .localhost hostname",
    );
  });

  it("allows localhost proxy hostname patterns", () => {
    const dir = writeConfig({
      version: 1,
      project: "fitbot",
      proxy: {
        enabled: true,
        hostnamePattern: "{service}.localhost",
      },
      services: {
        web: { cwd: ".", command: "pnpm dev" },
      },
    });

    const config = loadConfigExact(dir);
    expect(config.proxy?.hostnamePattern).toBe("{service}.localhost");
  });
});
