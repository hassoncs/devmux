import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverFromTurbo, formatDiscoveredConfig } from "../discovery/turbo.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function makeTurboRepo(opts: {
  turboJson: unknown;
  rootPackageJson: unknown;
  workspaces?: Array<{ dir: string; packageJson: unknown }>;
}): string {
  const root = mkdtempSync(join(tmpdir(), "devmux-turbo-"));
  tempDirs.push(root);

  writeFileSync(join(root, "turbo.json"), JSON.stringify(opts.turboJson));
  writeFileSync(join(root, "package.json"), JSON.stringify(opts.rootPackageJson));

  for (const ws of opts.workspaces ?? []) {
    const dir = join(root, ws.dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify(ws.packageJson));
  }

  return root;
}

describe("discoverFromTurbo", () => {
  it("returns null when turbo.json is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "devmux-turbo-"));
    tempDirs.push(root);
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "test" }));
    expect(discoverFromTurbo(root)).toBeNull();
  });

  it("discovers persistent tasks and maps them to services", () => {
    const root = makeTurboRepo({
      turboJson: {
        tasks: {
          dev: { persistent: true },
          build: { persistent: false },
        },
      },
      rootPackageJson: {
        name: "my-mono",
        workspaces: ["apps/web", "apps/api"],
      },
      workspaces: [
        {
          dir: "apps/web",
          packageJson: { name: "@mono/web", scripts: { dev: "vite", build: "vite build" } },
        },
        {
          dir: "apps/api",
          packageJson: { name: "@mono/api", scripts: { dev: "node index.js" } },
        },
      ],
    });

    const result = discoverFromTurbo(root);
    expect(result).not.toBeNull();
    expect(result!.services).toBeDefined();
    const services = result!.services!;
    // Both packages have `dev` which is persistent
    expect(Object.keys(services)).toContain("apps-web-dev");
    expect(Object.keys(services)).toContain("apps-api-dev");
    // `build` is not persistent
    expect(Object.keys(services)).not.toContain("apps-web-build");
  });
});

describe("formatDiscoveredConfig — stdout is pure JSON", () => {
  it("returns a string that parses as valid JSON", () => {
    // Suppress stderr advisory output during test
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const root = makeTurboRepo({
      turboJson: { tasks: { dev: { persistent: true } } },
      rootPackageJson: {
        name: "my-mono",
        workspaces: ["apps/web"],
      },
      workspaces: [
        {
          dir: "apps/web",
          packageJson: { name: "@mono/web", scripts: { dev: "vite" } },
        },
      ],
    });

    const discovered = discoverFromTurbo(root);
    expect(discovered).not.toBeNull();

    const output = formatDiscoveredConfig(discovered!);

    // The returned string must be valid JSON — no comment lines allowed
    expect(() => JSON.parse(output)).not.toThrow();

    const parsed = JSON.parse(output);
    expect(parsed).toMatchObject({ version: 1, services: expect.any(Object) });

    // Advisory notes must have gone to stderr, not stdout
    expect(stderrSpy).toHaveBeenCalled();
    const stderrContent = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrContent).toContain("Discovered from turbo.json");
  });

  it("does NOT include comment lines in the returned string", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const config = { version: 1 as const, project: "test", services: { api: { cwd: ".", command: "node index.js" } } };
    const output = formatDiscoveredConfig(config);

    // No line starting with '#' (shell-comment-style advisory)
    for (const line of output.split("\n")) {
      expect(line.trimStart()).not.toMatch(/^#/);
    }

    stderrSpy.mockRestore();
  });
});
