import { afterEach, describe, expect, it } from "vitest";
import { chdir } from "node:process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectLocalPortReport } from "../ports/report.js";

const tempDirs: string[] = [];
const originalCwd = process.cwd();

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "devmux-ports-report-"));
  tempDirs.push(dir);
  return dir;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

afterEach(() => {
  chdir(originalCwd);
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("collectLocalPortReport", () => {
  it("reports ports for the current project's devmux config", async () => {
    const root = makeTempDir();
    mkdirSync(root, { recursive: true });

    writeJson(join(root, "devmux.config.json"), {
      version: 1,
      project: "alpha",
      services: {
        api: {
          cwd: ".",
          command: "pnpm dev",
          health: { type: "port", port: 8787 },
        },
        web: {
          cwd: ".",
          command: "pnpm web",
          health: { type: "http", url: "http://localhost:8091/health" },
        },
      },
    });

    chdir(root);
    const report = await collectLocalPortReport();

    expect(report.project).toBe("alpha");
    expect(report.summary.serviceCount).toBe(2);
    expect(report.summary.servicesWithPorts).toBe(2);
    expect(
      report.services.map((service) => [service.serviceName, service.basePort]),
    ).toEqual([
      ["web", 8091],
      ["api", 8787],
    ]);
  });

  it("keeps services without configured ports in the report", async () => {
    const root = makeTempDir();
    writeJson(join(root, "devmux.config.json"), {
      version: 1,
      project: "alpha",
      services: {
        ios: {
          cwd: ".",
          command: "pnpm ios",
        },
      },
    });

    chdir(root);
    const report = await collectLocalPortReport();

    expect(report.summary.serviceCount).toBe(1);
    expect(report.summary.servicesWithPorts).toBe(0);
    expect(report.services[0]).toMatchObject({
      serviceName: "ios",
      healthType: "none",
      basePort: undefined,
    });
  });
});
