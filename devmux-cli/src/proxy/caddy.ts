const DEVMUX_ID_PREFIX = "devmux_";

// ── Caddy API shape interfaces ────────────────────────────────────────────────

interface CaddyInnerHandle {
  handler: string;
  transport?: { protocol: string; response_header_timeout: string };
  upstreams?: Array<{ dial: string }>;
}

interface CaddyOuterHandle {
  handler: string;
  routes?: Array<{ handle?: CaddyInnerHandle[] }>;
}

interface CaddyRoute {
  "@id"?: string;
  match?: Array<{ host?: string[] }>;
  terminal?: boolean;
  handle?: CaddyOuterHandle[];
}

interface CaddyServerConfig {
  routes?: CaddyRoute[];
  listen?: string[];
}

interface CaddyConfig {
  apps?: {
    http?: {
      servers?: Record<string, CaddyServerConfig>;
    };
  };
}

const DEFAULT_SERVER_NAME = "srv0";
const DEFAULT_SERVER_CONFIG: CaddyServerConfig = {
  listen: [":80"],
  routes: [],
};
const DUPLICATE_ROUTE_ID_FRAGMENT = "duplicate ID";
const REGISTER_ROUTE_MAX_ATTEMPTS = 2;

// ── Helpers ──────────────────────────────────────────────────────────────────

function toRouteId(hostname: string): string {
  return DEVMUX_ID_PREFIX + hostname.replace(/[.\-]/g, "_");
}

function buildRoute(hostname: string, port: number): CaddyRoute {
  return {
    "@id": toRouteId(hostname),
    match: [{ host: [hostname] }],
    terminal: true,
    handle: [
      {
        handler: "subroute",
        routes: [
          {
            handle: [
              {
                handler: "reverse_proxy",
                transport: { protocol: "http", response_header_timeout: "0s" },
                upstreams: [{ dial: `localhost:${port}` }],
              },
            ],
          },
        ],
      },
    ],
  };
}

function parseManagedRoute(
  route: CaddyRoute,
): { hostname: string; port: number } | null {
  const id = route["@id"];
  if (typeof id !== "string" || !id.startsWith(DEVMUX_ID_PREFIX)) return null;

  const hostname = route.match?.[0]?.host?.[0];
  if (!hostname) return null;

  const outerHandle = route.handle?.[0];
  if (!outerHandle || outerHandle.handler !== "subroute") return null;

  const innerHandle = outerHandle.routes?.[0]?.handle?.[0];
  if (!innerHandle) return null;

  const dial = innerHandle.upstreams?.[0]?.dial;
  if (!dial) return null;

  const portStr = dial.split(":")[1];
  if (!portStr) return null;

  const port = parseInt(portStr, 10);
  if (isNaN(port)) return null;

  return { hostname, port };
}

function isDuplicateRouteIdError(message: string): boolean {
  return message.includes(DUPLICATE_ROUTE_ID_FRAGMENT);
}

// ── CaddyManager ─────────────────────────────────────────────────────────────

export class CaddyManager {
  private readonly adminUrl: string;
  private readonly adminOrigin: string;
  private cachedServerName: string | null = null;

  constructor(adminUrl = "http://localhost:2019") {
    this.adminUrl = adminUrl;
    this.adminOrigin = new URL(adminUrl).origin;
  }

  /**
   * Node.js 24+ fetch sends `sec-fetch-mode: cors` which triggers Caddy's CSRF check.
   * The check passes when `Origin` matches the admin listen address.
   */
  private fetchAdmin(url: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    headers.set("Origin", this.adminOrigin);
    return fetch(url, { ...init, headers });
  }

  /** Returns true when the Caddy admin API is reachable. */
  async isAvailable(): Promise<boolean> {
    try {
      const res = await this.fetchAdmin(`${this.adminUrl}/config/`);
      return res.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Discovers the first HTTP server name from Caddy config (e.g. "srv0").
   * Result is cached for the lifetime of this instance.
   */
  async getServerName(): Promise<string> {
    if (this.cachedServerName !== null) return this.cachedServerName;

    const res = await this.fetchAdmin(
      `${this.adminUrl}/config/apps/http/servers/`,
    );
    if (!res.ok) {
      if (res.status === 400 || res.status === 404) {
        const putRes = await this.fetchAdmin(
          `${this.adminUrl}/config/apps/http/servers/${DEFAULT_SERVER_NAME}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(DEFAULT_SERVER_CONFIG),
          },
        );
        if (!putRes.ok) {
          throw new Error(
            `Failed to create default Caddy HTTP server: ${putRes.status} ${putRes.statusText}`,
          );
        }
        this.cachedServerName = DEFAULT_SERVER_NAME;
        return this.cachedServerName;
      }
      throw new Error(
        `Caddy API error getting servers: ${res.status} ${res.statusText}`,
      );
    }

    const servers = (await res.json()) as Record<string, CaddyServerConfig>;
    const names = Object.keys(servers);
    if (names.length === 0) {
      throw new Error("Caddy has no configured HTTP servers");
    }

    this.cachedServerName = names[0];
    return this.cachedServerName;
  }

  /**
   * Registers (upserts) a reverse-proxy route for the given hostname → port.
   * Deletes any existing route with the same ID first, then POSTs the new one.
   */
  async registerRoute(hostname: string, port: number): Promise<void> {
    for (let attempt = 1; attempt <= REGISTER_ROUTE_MAX_ATTEMPTS; attempt++) {
      const result = await this.tryRegisterRoute(hostname, port);
      if (result === "ok") return;

      if (!isDuplicateRouteIdError(result)) {
        throw new Error(result);
      }

      const existingRoute = await this.getManagedRoute(hostname);
      if (existingRoute?.port === port) {
        return;
      }

      if (
        attempt < REGISTER_ROUTE_MAX_ATTEMPTS &&
        isDuplicateRouteIdError(result)
      ) {
        continue;
      }

      throw new Error(result);
    }
  }

  private async tryRegisterRoute(
    hostname: string,
    port: number,
  ): Promise<"ok" | string> {
    const serverName = await this.getServerName();
    const route = buildRoute(hostname, port);
    const configRes = await this.fetchAdmin(`${this.adminUrl}/config/`);

    if (!configRes.ok) {
      return `Failed to read full Caddy config for "${hostname}": ${configRes.status} ${configRes.statusText}`;
    }

    const config = ((await configRes.json()) as CaddyConfig) ?? {};
    config.apps ??= {};
    config.apps.http ??= {};
    config.apps.http.servers ??= {};

    const serverConfig =
      config.apps.http.servers[serverName] ?? DEFAULT_SERVER_CONFIG;
    const existingRoutes = Array.isArray(serverConfig.routes)
      ? serverConfig.routes
      : [];
    const filteredRoutes = Array.isArray(existingRoutes)
      ? existingRoutes.filter((existing) => existing["@id"] !== route["@id"])
      : [];
    const nextServerConfig: CaddyServerConfig = {
      listen: serverConfig.listen ?? DEFAULT_SERVER_CONFIG.listen,
      routes: [route, ...filteredRoutes],
    };
    config.apps.http.servers[serverName] = nextServerConfig;

    const loadRes = await this.fetchAdmin(`${this.adminUrl}/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });

    if (loadRes.ok) return "ok";

    const body = await loadRes.text().catch(() => "");
    return `Failed to register Caddy route for "${hostname}": ${loadRes.status} ${loadRes.statusText}${body ? ` — ${body}` : ""}`;
  }

  private async getManagedRoute(
    hostname: string,
  ): Promise<{ hostname: string; port: number } | null> {
    const routes = await this.listRoutes();
    return routes.find((route) => route.hostname === hostname) ?? null;
  }

  /**
   * Removes the route for the given hostname. Swallows 404 (idempotent).
   */
  async deregisterRoute(hostname: string): Promise<void> {
    const id = toRouteId(hostname);
    const res = await this.fetchAdmin(`${this.adminUrl}/id/${id}`, {
      method: "DELETE",
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(
        `Failed to deregister Caddy route "${id}": ${res.status} ${res.statusText}`,
      );
    }
  }

  /**
   * Returns all routes whose @id starts with "devmux_", parsed as { hostname, port } pairs.
   */
  async listRoutes(): Promise<Array<{ hostname: string; port: number }>> {
    const serverName = await this.getServerName();
    const res = await this.fetchAdmin(
      `${this.adminUrl}/config/apps/http/servers/${serverName}/routes`,
    );

    if (!res.ok) {
      throw new Error(
        `Failed to list Caddy routes: ${res.status} ${res.statusText}`,
      );
    }

    const routes = (await res.json()) as CaddyRoute[];
    if (!Array.isArray(routes)) return [];

    const result: Array<{ hostname: string; port: number }> = [];

    for (const route of routes) {
      const managedRoute = parseManagedRoute(route);
      if (!managedRoute) continue;
      result.push(managedRoute);
    }

    return result;
  }
}

export const caddy = new CaddyManager();

// ── Quick smoke-test when run directly ───────────────────────────────────────
if (process.argv[1] === import.meta.url.slice(7)) {
  (async () => {
    console.log("isAvailable:", await caddy.isAvailable());
    console.log("serverName:", await caddy.getServerName());

    await caddy.registerRoute("test.devmux.localhost", 9876);
    console.log("registered test.devmux.localhost → 9876");

    await caddy.registerRoute("test.devmux.localhost", 9999);
    console.log("re-registered test.devmux.localhost → 9999 (upsert)");

    const routes = await caddy.listRoutes();
    console.log("listRoutes:", JSON.stringify(routes, null, 2));

    await caddy.deregisterRoute("test.devmux.localhost");
    console.log("deregistered test.devmux.localhost");

    const after = await caddy.listRoutes();
    console.log("listRoutes after deregister:", JSON.stringify(after, null, 2));
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
