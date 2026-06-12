import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import type { DevMuxConfig, ServiceDefinition } from "../config/types.js";

interface TurboTask {
  persistent?: boolean;
  dependsOn?: string[];
}

interface TurboConfig {
  tasks?: Record<string, TurboTask>;
  pipeline?: Record<string, TurboTask>;
}

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
}

interface WorkspacePackage {
  name: string;
  path: string;
  scripts: string[];
}

function loadTurboConfig(root: string): TurboConfig | null {
  const turboPath = resolve(root, "turbo.json");
  if (!existsSync(turboPath)) return null;

  try {
    return JSON.parse(readFileSync(turboPath, "utf-8"));
  } catch {
    return null;
  }
}

function getPersistentTasks(turbo: TurboConfig): string[] {
  const tasks = turbo.tasks ?? turbo.pipeline ?? {};
  return Object.entries(tasks)
    .filter(([_, task]) => task.persistent)
    .map(([name]) => name.replace(/^\/\/#/, ""));
}

/**
 * Minimal parser for pnpm-workspace.yaml's `packages:` list — enough to
 * avoid a YAML dependency for the common shape:
 *   packages:
 *     - "apps/*"
 *     - packages/foo
 */
function readPnpmWorkspacePatterns(root: string): string[] {
  const yamlPath = resolve(root, "pnpm-workspace.yaml");
  if (!existsSync(yamlPath)) return [];
  try {
    const lines = readFileSync(yamlPath, "utf-8").split("\n");
    const patterns: string[] = [];
    let inPackages = false;
    for (const line of lines) {
      if (/^packages\s*:/.test(line)) {
        inPackages = true;
        continue;
      }
      if (inPackages) {
        const m = line.match(/^\s+-\s*["']?([^"'#\s]+)["']?/);
        if (m) {
          if (!m[1].startsWith("!")) patterns.push(m[1]);
        } else if (/^\S/.test(line)) {
          inPackages = false;
        }
      }
    }
    return patterns;
  } catch {
    return [];
  }
}

function findWorkspacePackages(root: string): WorkspacePackage[] {
  const packages: WorkspacePackage[] = [];

  const rootPkg = resolve(root, "package.json");
  if (!existsSync(rootPkg)) return packages;

  try {
    const pkg: PackageJson & { workspaces?: string[] } = JSON.parse(
      readFileSync(rootPkg, "utf-8")
    );

    const workspaces = [
      ...(pkg.workspaces ?? []),
      ...readPnpmWorkspacePatterns(root),
    ];

    for (const pattern of workspaces) {
      // "apps/*" enumerates the children of apps/; "apps/web" is used as-is.
      const candidates: string[] = [];
      if (pattern.endsWith("/*")) {
        const parent = resolve(root, pattern.slice(0, -2));
        if (existsSync(parent)) {
          try {
            for (const entry of readdirSync(parent, { withFileTypes: true })) {
              if (entry.isDirectory()) candidates.push(resolve(parent, entry.name));
            }
          } catch {}
        }
      } else {
        candidates.push(resolve(root, pattern));
      }

      for (const candidate of candidates) {
        const pkgPath = resolve(candidate, "package.json");
        const relPath = relative(root, candidate) || ".";
        if (existsSync(pkgPath) && !packages.some((p) => p.path === relPath)) {
          const subPkg: PackageJson = JSON.parse(readFileSync(pkgPath, "utf-8"));
          packages.push({
            name: subPkg.name ?? relPath,
            path: relPath,
            scripts: Object.keys(subPkg.scripts ?? {}),
          });
        }
      }
    }

    for (const subdir of ["app", "api", "web", "packages", "apps"]) {
      const pkgPath = resolve(root, subdir, "package.json");
      if (existsSync(pkgPath) && !packages.some((p) => p.path === subdir)) {
        const subPkg: PackageJson = JSON.parse(readFileSync(pkgPath, "utf-8"));
        packages.push({
          name: subPkg.name ?? subdir,
          path: subdir,
          scripts: Object.keys(subPkg.scripts ?? {}),
        });
      }
    }
  } catch {}

  return packages;
}

export function discoverFromTurbo(root: string): Partial<DevMuxConfig> | null {
  const turbo = loadTurboConfig(root);
  if (!turbo) return null;

  const persistentTasks = getPersistentTasks(turbo);
  if (persistentTasks.length === 0) return null;

  const packages = findWorkspacePackages(root);
  const services: Record<string, ServiceDefinition> = {};

  for (const pkg of packages) {
    for (const task of persistentTasks) {
      if (pkg.scripts.includes(task)) {
        const serviceName = pkg.path === "." ? task : `${pkg.path.replace(/\//g, "-")}-${task}`;

        services[serviceName] = {
          cwd: pkg.path,
          command: `pnpm ${task}`,
        };
      }
    }
  }

  if (Object.keys(services).length === 0) return null;

  return {
    version: 1,
    project: "my-project",
    services,
  };
}

export function formatDiscoveredConfig(config: Partial<DevMuxConfig>): string {
  const notes = [
    "# Discovered from turbo.json — review and update:",
    "#   1. Set 'project' name",
    "#   2. Add health checks (port or http) for each service",
    "#   3. Remove services you don't want to manage",
  ].join("\n");

  process.stderr.write(notes + "\n");

  return JSON.stringify(config, null, 2);
}
