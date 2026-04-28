import { describe, it, expect, vi, beforeEach } from "vitest";
import { CaddyManager } from "../proxy/caddy.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeResponse(status: number, body: unknown = null): Response {
  const bodyStr = JSON.stringify(body) ?? "";
  return new Response(bodyStr, {
    status,
    headers: { "Content-Type": "application/json" },
  }) as Response;
}

const SERVERS_RESPONSE = { srv0: { listen: [":80"] } };

const ROUTE_WITH_DEVMUX_ID = {
  "@id": "devmux_api_myapp_localhost",
  match: [{ host: ["api.myapp.localhost"] }],
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
              upstreams: [{ dial: "localhost:4001" }],
            },
          ],
        },
      ],
    },
  ],
};

const ROUTE_WITHOUT_DEVMUX_ID = {
  "@id": "manual_route",
  match: [{ host: ["other.localhost"] }],
  terminal: true,
  handle: [
    {
      handler: "subroute",
      routes: [
        {
          handle: [
            {
              handler: "reverse_proxy",
              upstreams: [{ dial: "localhost:9000" }],
            },
          ],
        },
      ],
    },
  ],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CaddyManager", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let manager: CaddyManager;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    manager = new CaddyManager("http://localhost:2019");
  });

  // ── isAvailable ───────────────────────────────────────────────────────────

  describe("isAvailable", () => {
    it("returns true when admin API responds with 200", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(200, {}));
      expect(await manager.isAvailable()).toBe(true);
    });

    it("returns false when admin API responds with non-200", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(503, {}));
      expect(await manager.isAvailable()).toBe(false);
    });

    it("returns false on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      expect(await manager.isAvailable()).toBe(false);
    });
  });

  // ── getServerName ─────────────────────────────────────────────────────────

  describe("getServerName", () => {
    it("discovers and returns the first server name", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(200, SERVERS_RESPONSE));
      expect(await manager.getServerName()).toBe("srv0");
    });

    it("caches the server name (only one fetch call for two invocations)", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(200, SERVERS_RESPONSE));
      const first = await manager.getServerName();
      const second = await manager.getServerName();
      expect(first).toBe("srv0");
      expect(second).toBe("srv0");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("creates a default server when Caddy has no HTTP server config yet", async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse(400, {}))
        .mockResolvedValueOnce(makeResponse(200, {}));
      expect(await manager.getServerName()).toBe("srv0");
    });

    it("throws on non-ok response", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(500, {}));
      await expect(manager.getServerName()).rejects.toThrow(
        "Caddy API error getting servers",
      );
    });
  });

  // ── registerRoute ─────────────────────────────────────────────────────────

  describe("registerRoute", () => {
    it("prepends the route via full-config load with correct URL and body", async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse(200, SERVERS_RESPONSE))
        .mockResolvedValueOnce(
          makeResponse(200, {
            apps: {
              http: {
                servers: {
                  srv0: {
                    listen: [":80"],
                    routes: [ROUTE_WITHOUT_DEVMUX_ID],
                  },
                },
              },
            },
          }),
        )
        .mockResolvedValueOnce(makeResponse(200, {}));

      await manager.registerRoute("api.myapp.localhost", 4001);

      expect(mockFetch).toHaveBeenCalledTimes(3);

      const [putUrl, putInit] = mockFetch.mock.calls[2] as [
        string,
        RequestInit,
      ];
      expect(putUrl).toBe("http://localhost:2019/load");
      expect(putInit.method).toBe("POST");

      const body = JSON.parse(putInit.body as string) as Record<
        string,
        unknown
      >;
      const routes = (
        ((body.apps as Record<string, unknown>).http as Record<string, unknown>)
          .servers as Record<string, { routes: Array<Record<string, unknown>> }>
      ).srv0.routes;
      expect(routes[0]?.["@id"]).toBe("devmux_api_myapp_localhost");
      expect((routes[0]?.match as Array<{ host: string[] }>)[0].host[0]).toBe(
        "api.myapp.localhost",
      );
      expect(routes[1]?.["@id"]).toBe("manual_route");
    });

    it("sends Origin header on all requests", async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse(200, SERVERS_RESPONSE))
        .mockResolvedValueOnce(
          makeResponse(200, {
            apps: {
              http: {
                servers: {
                  srv0: {
                    listen: [":80"],
                    routes: [],
                  },
                },
              },
            },
          }),
        )
        .mockResolvedValueOnce(makeResponse(200, {}));

      await manager.registerRoute("app.test.localhost", 4002);

      for (const [, init] of mockFetch.mock.calls as Array<
        [string, RequestInit]
      >) {
        const headers = init.headers as Headers;
        expect(headers.get("Origin")).toBe("http://localhost:2019");
      }
    });

    it("throws when POST fails", async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse(200, SERVERS_RESPONSE))
        .mockResolvedValueOnce(
          makeResponse(200, {
            apps: {
              http: {
                servers: {
                  srv0: {
                    listen: [":80"],
                    routes: [],
                  },
                },
              },
            },
          }),
        )
        .mockResolvedValueOnce(makeResponse(500, "internal error"));

      await expect(
        manager.registerRoute("bad.localhost", 9999),
      ).rejects.toThrow('Failed to register Caddy route for "bad.localhost"');
    });

    it("treats duplicate route ID as success when the existing route already matches", async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse(200, SERVERS_RESPONSE))
        .mockResolvedValueOnce(
          makeResponse(200, {
            apps: {
              http: {
                servers: {
                  srv0: {
                    listen: [":80"],
                    routes: [],
                  },
                },
              },
            },
          }),
        )
        .mockResolvedValueOnce(
          makeResponse(400, "indexing config: duplicate ID 'devmux_api_myapp_localhost' found"),
        )
        .mockResolvedValueOnce(makeResponse(200, [ROUTE_WITH_DEVMUX_ID]));

      await expect(
        manager.registerRoute("api.myapp.localhost", 4001),
      ).resolves.toBeUndefined();

      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it("retries duplicate route ID conflicts and throws when the existing route points elsewhere", async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse(200, SERVERS_RESPONSE))
        .mockResolvedValueOnce(
          makeResponse(200, {
            apps: {
              http: {
                servers: {
                  srv0: {
                    listen: [":80"],
                    routes: [],
                  },
                },
              },
            },
          }),
        )
        .mockResolvedValueOnce(
          makeResponse(400, "indexing config: duplicate ID 'devmux_api_myapp_localhost' found"),
        )
        .mockResolvedValueOnce(
          makeResponse(200, [
            {
              ...ROUTE_WITH_DEVMUX_ID,
              handle: [
                {
                  handler: "subroute",
                  routes: [
                    {
                      handle: [
                        {
                          handler: "reverse_proxy",
                          transport: {
                            protocol: "http",
                            response_header_timeout: "0s",
                          },
                          upstreams: [{ dial: "localhost:4999" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ]),
        )
        .mockResolvedValueOnce(
          makeResponse(200, {
            apps: {
              http: {
                servers: {
                  srv0: {
                    listen: [":80"],
                    routes: [],
                  },
                },
              },
            },
          }),
        )
        .mockResolvedValueOnce(
          makeResponse(400, "indexing config: duplicate ID 'devmux_api_myapp_localhost' found"),
        )
        .mockResolvedValueOnce(
          makeResponse(200, [
            {
              ...ROUTE_WITH_DEVMUX_ID,
              handle: [
                {
                  handler: "subroute",
                  routes: [
                    {
                      handle: [
                        {
                          handler: "reverse_proxy",
                          transport: {
                            protocol: "http",
                            response_header_timeout: "0s",
                          },
                          upstreams: [{ dial: "localhost:4999" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ]),
        );

      await expect(
        manager.registerRoute("api.myapp.localhost", 4001),
      ).rejects.toThrow('Failed to register Caddy route for "api.myapp.localhost": 400');

      expect(mockFetch).toHaveBeenCalledTimes(7);
    });

    it("retries duplicate route ID conflicts and succeeds when the second attempt converges", async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse(200, SERVERS_RESPONSE))
        .mockResolvedValueOnce(
          makeResponse(200, {
            apps: {
              http: {
                servers: {
                  srv0: {
                    listen: [":80"],
                    routes: [],
                  },
                },
              },
            },
          }),
        )
        .mockResolvedValueOnce(
          makeResponse(400, "indexing config: duplicate ID 'devmux_api_myapp_localhost' found"),
        )
        .mockResolvedValueOnce(makeResponse(200, []))
        .mockResolvedValueOnce(
          makeResponse(200, {
            apps: {
              http: {
                servers: {
                  srv0: {
                    listen: [":80"],
                    routes: [],
                  },
                },
              },
            },
          }),
        )
        .mockResolvedValueOnce(makeResponse(200, {}));

      await expect(
        manager.registerRoute("api.myapp.localhost", 4001),
      ).resolves.toBeUndefined();

      expect(mockFetch).toHaveBeenCalledTimes(6);
    });
  });

  // ── deregisterRoute ───────────────────────────────────────────────────────

  describe("deregisterRoute", () => {
    it("sends DELETE to the correct route ID endpoint", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(200, {}));

      await manager.deregisterRoute("api.myapp.localhost");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://localhost:2019/id/devmux_api_myapp_localhost");
      expect(init.method).toBe("DELETE");
    });

    it("swallows 404 response (idempotent, no throw)", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(404, null));
      await expect(
        manager.deregisterRoute("gone.localhost"),
      ).resolves.toBeUndefined();
    });

    it("throws on non-404 error responses", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(500, null));
      await expect(manager.deregisterRoute("broken.localhost")).rejects.toThrow(
        'Failed to deregister Caddy route "devmux_broken_localhost"',
      );
    });
  });

  // ── listRoutes ────────────────────────────────────────────────────────────

  describe("listRoutes", () => {
    it("returns only devmux_ routes, filtering non-devmux ones", async () => {
      const routes = [ROUTE_WITH_DEVMUX_ID, ROUTE_WITHOUT_DEVMUX_ID];
      mockFetch
        .mockResolvedValueOnce(makeResponse(200, SERVERS_RESPONSE))
        .mockResolvedValueOnce(makeResponse(200, routes));

      const result = await manager.listRoutes();

      expect(result).toHaveLength(1);
      expect(result[0].hostname).toBe("api.myapp.localhost");
      expect(result[0].port).toBe(4001);
    });

    it("returns empty array when no routes exist", async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse(200, SERVERS_RESPONSE))
        .mockResolvedValueOnce(makeResponse(200, []));

      expect(await manager.listRoutes()).toEqual([]);
    });

    it("returns empty array when response is not an array", async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse(200, SERVERS_RESPONSE))
        .mockResolvedValueOnce(makeResponse(200, null));

      expect(await manager.listRoutes()).toEqual([]);
    });

    it("throws on non-ok response", async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse(200, SERVERS_RESPONSE))
        .mockResolvedValueOnce(makeResponse(500, null));

      await expect(manager.listRoutes()).rejects.toThrow(
        "Failed to list Caddy routes",
      );
    });
  });
});
