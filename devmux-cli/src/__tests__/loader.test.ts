import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, loadConfigExact } from "../config/loader.js";

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

describe("loadConfig (walk-up discovery)", () => {
  it("finds devmux.config.json when invoked from a nested subdirectory", () => {
    // Regression: stale dist only checked the start dir; correct source walks
    // up to filesystem root. This test exercises the exact palot failure case:
    // `devmux ensure <svc>` run from apps/desktop/ could not find the root config.
    const root = mkdtempSync(join(tmpdir(), "devmux-walkup-"));
    tempDirs.push(root);

    writeFileSync(
      join(root, "devmux.config.json"),
      JSON.stringify(
        {
          version: 1,
          project: "walkup-test",
          services: {
            api: { command: "node server.js" },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const subDir = join(root, "apps", "desktop");
    mkdirSync(subDir, { recursive: true });

    const config = loadConfig(subDir);
    expect(config.project).toBe("walkup-test");
    expect(config.configRoot).toBe(root);
  });

  it("throws a helpful error when no config exists anywhere in the tree", () => {
    const isolated = mkdtempSync(join(tmpdir(), "devmux-noconfig-"));
    tempDirs.push(isolated);
    const subDir = join(isolated, "deep", "nested");
    mkdirSync(subDir, { recursive: true });

    expect(() => loadConfig(subDir)).toThrow("No devmux config found");
  });
});

describe("loadConfigExact", () => {
  it("rejects non-localhost proxy hostname patterns", () => {
    const dir = writeConfig({
      version: 1,
      project: "fitbot",
      proxy: {
        enabled: true,
        hostnamePattern: "{service}.{project}.corp.example",
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
