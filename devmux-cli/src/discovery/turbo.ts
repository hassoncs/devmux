import { readFileSync, existsSync } from "node:fs";
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

function findWorkspacePackages(root: string): WorkspacePackage[] {
  const packages: WorkspacePackage[] = [];

  const rootPkg = resolve(root, "package.json");
  if (!existsSync(rootPkg)) return packages;

  try {
    const pkg: PackageJson & { workspaces?: string[] } = JSON.parse(
      readFileSync(rootPkg, "utf-8")
    );

    const workspaces = pkg.workspaces ?? [];

    for (const pattern of workspaces) {
      const cleanPattern = pattern.replace(/\/\*$/, "");
      const pkgPath = resolve(root, cleanPattern, "package.json");

      if (existsSync(pkgPath)) {
        const subPkg: PackageJson = JSON.parse(readFileSync(pkgPath, "utf-8"));
        packages.push({
          name: subPkg.name ?? cleanPattern,
          path: relative(root, resolve(root, cleanPattern)) || ".",
          scripts: Object.keys(subPkg.scripts ?? {}),
        });
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
          health: { type: "none" },
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
  const lines: string[] = [
    "# Discovered from turbo.json",
    "# Review and update:",
    "#   1. Set 'project' name",
    "#   2. Add health checks (port or http) for each service",
    "#   3. Remove services you don't want to manage",
    "",
    JSON.stringify(config, null, 2),
  ];

  return lines.join("\n");
}
