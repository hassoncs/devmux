import * as http from "node:http";
import type { RouteInfo } from "./routes.js";

const HOP_BY_HOP_HEADERS = new Set([
	"connection",
	"keep-alive",
	"proxy-connection",
	"transfer-encoding",
	"upgrade",
]);

function getRequestHost(req: http.IncomingMessage): string {
	return req.headers.host || "";
}

function buildForwardedHeaders(req: http.IncomingMessage): Record<string, string> {
	const remoteAddress = req.socket.remoteAddress || "127.0.0.1";
	const hostHeader = getRequestHost(req);
	return {
		"x-forwarded-for": req.headers["x-forwarded-for"]
			? `${req.headers["x-forwarded-for"]}, ${remoteAddress}`
			: remoteAddress,
		"x-forwarded-proto": (req.headers["x-forwarded-proto"] as string) || "http",
		"x-forwarded-host": (req.headers["x-forwarded-host"] as string) || hostHeader,
		"x-forwarded-port": (req.headers["x-forwarded-port"] as string) || hostHeader.split(":")[1] || "80",
	};
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

export interface ProxyServerOptions {
	getRoutes: () => RouteInfo[];
	proxyPort: number;
	onError?: (msg: string) => void;
}

export function createProxyServer(options: ProxyServerOptions): http.Server {
	const { getRoutes, proxyPort, onError = (msg) => console.error(msg) } = options;

	const handleRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
		res.setHeader("X-Portless", "1");
		const routes = getRoutes();
		const host = getRequestHost(req).split(":")[0];

		if (!host) {
			res.writeHead(400, { "Content-Type": "text/plain" });
			res.end("Missing Host header");
			return;
		}

		const route = routes.find((r) => r.hostname === host);
		if (!route) {
			const safeHost = escapeHtml(host);
			res.writeHead(404, { "Content-Type": "text/html" });
			res.end(`<html><body>
				<h1>Not Found</h1>
				<p>No app registered for <strong>${safeHost}</strong></p>
				${routes.length > 0
					? `<ul>${routes.map((r) =>
						`<li>${escapeHtml(r.hostname)} → localhost:${r.port}</li>`
					).join("")}</ul>`
					: "<p><em>No apps running.</em></p>"}
			</body></html>`);
			return;
		}

		const forwardedHeaders = buildForwardedHeaders(req);
		const proxyReqHeaders = { ...req.headers, ...forwardedHeaders };
		for (const key of HOP_BY_HOP_HEADERS) {
			delete proxyReqHeaders[key];
		}

		const proxyReq = http.request(
			{
				hostname: "localhost",
				port: route.port,
				path: req.url,
				method: req.method,
				headers: proxyReqHeaders,
			},
			(proxyRes) => {
				res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
				proxyRes.pipe(res);
			},
		);

		proxyReq.on("error", (err) => {
			onError(`Proxy error for ${getRequestHost(req)}: ${err.message}`);
			if (!res.headersSent) {
				const code = (err as NodeJS.ErrnoException).code;
				const message = code === "ECONNREFUSED"
					? "Bad Gateway: the target app is not responding."
					: "Bad Gateway: the target app may not be running.";
				res.writeHead(502, { "Content-Type": "text/plain" });
				res.end(message);
			}
		});

		res.on("close", () => { if (!proxyReq.destroyed) proxyReq.destroy(); });
		req.on("error", () => { if (!proxyReq.destroyed) proxyReq.destroy(); });
		req.pipe(proxyReq);
	};

	const handleUpgrade = (req: http.IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => {
		const routes = getRoutes();
		const host = getRequestHost(req).split(":")[0];
		const route = routes.find((r) => r.hostname === host);

		if (!route) {
			socket.destroy();
			return;
		}

		const forwardedHeaders = buildForwardedHeaders(req);
		const proxyReqHeaders = { ...req.headers, ...forwardedHeaders };

		const proxyReq = http.request({
			hostname: "localhost",
			port: route.port,
			path: req.url,
			method: req.method,
			headers: proxyReqHeaders,
		});

		proxyReq.on("upgrade", (_proxyRes, proxySocket, proxyHead) => {
			let response = `HTTP/1.1 101 Switching Protocols\r\n`;
			for (let i = 0; i < _proxyRes.rawHeaders.length; i += 2) {
				response += `${_proxyRes.rawHeaders[i]}: ${_proxyRes.rawHeaders[i + 1]}\r\n`;
			}
			response += "\r\n";
			socket.write(response);
			if (proxyHead.length > 0) socket.write(proxyHead);
			proxySocket.pipe(socket);
			socket.pipe(proxySocket);
			proxySocket.on("error", () => socket.destroy());
			socket.on("error", () => proxySocket.destroy());
		});

		proxyReq.on("error", (err) => {
			onError(`WebSocket proxy error for ${getRequestHost(req)}: ${err.message}`);
			socket.destroy();
		});

		proxyReq.on("response", (proxyRes) => {
			if (!socket.destroyed) {
				let response = `HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n`;
				for (let i = 0; i < proxyRes.rawHeaders.length; i += 2) {
					response += `${proxyRes.rawHeaders[i]}: ${proxyRes.rawHeaders[i + 1]}\r\n`;
				}
				response += "\r\n";
				socket.write(response);
				proxyRes.pipe(socket);
			}
		});

		if (head.length > 0) proxyReq.write(head);
		proxyReq.end();
	};

	const server = http.createServer(handleRequest);
	server.on("upgrade", handleUpgrade);
	return server;
}
