import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { checkHttp } from "../health/checkers.js";

const servers: Server[] = [];

function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    servers.push(server);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      const url = `http://127.0.0.1:${address.port}`;
      resolve({
        url,
        close: () =>
          new Promise<void>((res, rej) =>
            server.close((err) => (err ? rej(err) : res()))
          ),
      });
    });
    server.on("error", reject);
  });
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) => new Promise<void>((res) => s.close(() => res()))
    )
  );
});

describe("checkHttp — default behaviour (no expectStatus)", () => {
  it("treats 200 as healthy", async () => {
    const { url } = await startServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    expect(await checkHttp(url)).toBe(true);
  });

  it("treats 404 as healthy (server is up, just missing the path)", async () => {
    const { url } = await startServer((_req, res) => {
      res.writeHead(404);
      res.end("not found");
    });
    expect(await checkHttp(url)).toBe(true);
  });

  it("treats 500 as unhealthy", async () => {
    const { url } = await startServer((_req, res) => {
      res.writeHead(500);
      res.end("error");
    });
    expect(await checkHttp(url)).toBe(false);
  });

  it("treats 503 as unhealthy", async () => {
    const { url } = await startServer((_req, res) => {
      res.writeHead(503);
      res.end("unavailable");
    });
    expect(await checkHttp(url)).toBe(false);
  });

  it("returns false when nothing is listening", async () => {
    expect(await checkHttp("http://127.0.0.1:19998")).toBe(false);
  });
});

describe("checkHttp — expectStatus exact match", () => {
  it("200 is healthy when expectStatus=200", async () => {
    const { url } = await startServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    expect(await checkHttp(url, 200)).toBe(true);
  });

  it("404 is unhealthy when expectStatus=200", async () => {
    const { url } = await startServer((_req, res) => {
      res.writeHead(404);
      res.end("not found");
    });
    expect(await checkHttp(url, 200)).toBe(false);
  });

  it("401 is healthy when expectStatus=401 (auth-gated endpoint)", async () => {
    const { url } = await startServer((_req, res) => {
      res.writeHead(401);
      res.end("unauthorized");
    });
    expect(await checkHttp(url, 401)).toBe(true);
  });

  it("500 is unhealthy when expectStatus=200", async () => {
    const { url } = await startServer((_req, res) => {
      res.writeHead(500);
      res.end("error");
    });
    expect(await checkHttp(url, 200)).toBe(false);
  });
});
