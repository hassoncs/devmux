import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { exec } from "node:child_process";
import { loadConfig } from "../config/loader.js";
import { getAllStatus } from "../core/service.js";
import { renderDashboard, type DashboardData, type DashboardService } from "./template.js";
import type { ResolvedConfig, ServiceStatus } from "../config/types.js";

function getConfigPath(config: ResolvedConfig): string {
  const names = ["devmux.config.json", ".devmuxrc.json", ".devmuxrc"];
  for (const name of names) {
    const path = `${config.configRoot}/${name}`;
    if (existsSync(path)) return path;
  }
  return `${config.configRoot}/devmux.config.json`;
}

function statusToService(s: ServiceStatus, config: ResolvedConfig): DashboardService {
  const def = config.services[s.name];
  return {
    name: s.name,
    healthy: s.healthy,
    port: s.port,
    resolvedPort: s.resolvedPort,
    hasHealthCheck: def?.health !== undefined,
  };
}

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin" ? `open "${url}"` :
    process.platform === "win32" ? `cmd /c start "${url}"` :
    `xdg-open "${url}"`;

  exec(command, () => {});
}

export interface DashboardOptions {
  port?: number;
  open?: boolean;
}

export function startDashboard(options: DashboardOptions = {}): Server {
  const port = options.port ?? 9000;
  const shouldOpen = options.open ?? true;
  const config = loadConfig();
  const configPath = getConfigPath(config);

  const server = createServer(async (req, res) => {
    if (req.url === "/api/status") {
      try {
        const statuses = await getAllStatus(config);
        const payload = {
          project: config.project,
          instanceId: config.instanceId || null,
          configPath,
          services: statuses.map((s) => statusToService(s, config)),
        };
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
        });
        res.end(JSON.stringify(payload));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to fetch status" }));
      }
      return;
    }

    if (req.url === "/" || req.url === "/index.html") {
      try {
        const statuses = await getAllStatus(config);
        const data: DashboardData = {
          project: config.project,
          instanceId: config.instanceId || "",
          configPath,
          dashboardPort: port,
          services: statuses.map((s) => statusToService(s, config)),
        };
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        });
        res.end(renderDashboard(data));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Failed to render dashboard");
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`devmux dashboard running at ${url}`);
    console.log(`  Project: ${config.project}`);
    console.log(`  Config:  ${configPath}`);
    console.log("");
    console.log("Press Ctrl+C to stop.");

    if (shouldOpen) {
      openBrowser(url);
    }
  });

  return server;
}
