const DEVMUX_ID_PREFIX = 'devmux_';

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
	'@id'?: string;
	match?: Array<{ host?: string[] }>;
	terminal?: boolean;
	handle?: CaddyOuterHandle[];
}

interface CaddyServerConfig {
	routes?: CaddyRoute[];
	listen?: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toRouteId(hostname: string): string {
	return DEVMUX_ID_PREFIX + hostname.replace(/[.\-]/g, '_');
}

function buildRoute(hostname: string, port: number): CaddyRoute {
	return {
		'@id': toRouteId(hostname),
		match: [{ host: [hostname] }],
		terminal: true,
		handle: [
			{
				handler: 'subroute',
				routes: [
					{
						handle: [
							{
								handler: 'reverse_proxy',
								transport: { protocol: 'http', response_header_timeout: '0s' },
								upstreams: [{ dial: `localhost:${port}` }],
							},
						],
					},
				],
			},
		],
	};
}

// ── CaddyManager ─────────────────────────────────────────────────────────────

export class CaddyManager {
	private readonly adminUrl: string;
	private readonly adminOrigin: string;
	private cachedServerName: string | null = null;

	constructor(adminUrl = 'http://localhost:2019') {
		this.adminUrl = adminUrl;
		this.adminOrigin = new URL(adminUrl).origin;
	}

	/**
	 * Node.js 24+ fetch sends `sec-fetch-mode: cors` which triggers Caddy's CSRF check.
	 * The check passes when `Origin` matches the admin listen address.
	 */
	private fetchAdmin(url: string, init?: RequestInit): Promise<Response> {
		const headers = new Headers(init?.headers as HeadersInit | undefined);
		headers.set('Origin', this.adminOrigin);
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

		const res = await this.fetchAdmin(`${this.adminUrl}/config/apps/http/servers/`);
		if (!res.ok) {
			throw new Error(`Caddy API error getting servers: ${res.status} ${res.statusText}`);
		}

		const servers = (await res.json()) as Record<string, CaddyServerConfig>;
		const names = Object.keys(servers);
		if (names.length === 0) {
			throw new Error('Caddy has no configured HTTP servers');
		}

		this.cachedServerName = names[0];
		return this.cachedServerName;
	}

	/**
	 * Registers (upserts) a reverse-proxy route for the given hostname → port.
	 * Deletes any existing route with the same ID first, then POSTs the new one.
	 */
	async registerRoute(hostname: string, port: number): Promise<void> {
		const id = toRouteId(hostname);
		const serverName = await this.getServerName();

		// DELETE existing (swallow 404 — route may not exist yet)
		const delRes = await this.fetchAdmin(`${this.adminUrl}/id/${id}`, { method: 'DELETE' });
		if (!delRes.ok && delRes.status !== 404) {
			throw new Error(
				`Failed to remove existing Caddy route "${id}": ${delRes.status} ${delRes.statusText}`,
			);
		}

		const route = buildRoute(hostname, port);
		const postRes = await this.fetchAdmin(
			`${this.adminUrl}/config/apps/http/servers/${serverName}/routes`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(route),
			},
		);

		if (!postRes.ok) {
			const body = await postRes.text().catch(() => '');
			throw new Error(
				`Failed to register Caddy route for "${hostname}": ${postRes.status} ${postRes.statusText}${body ? ` — ${body}` : ''}`,
			);
		}
	}

	/**
	 * Removes the route for the given hostname. Swallows 404 (idempotent).
	 */
	async deregisterRoute(hostname: string): Promise<void> {
		const id = toRouteId(hostname);
		const res = await this.fetchAdmin(`${this.adminUrl}/id/${id}`, { method: 'DELETE' });
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
			throw new Error(`Failed to list Caddy routes: ${res.status} ${res.statusText}`);
		}

		const routes = (await res.json()) as CaddyRoute[];
		if (!Array.isArray(routes)) return [];

		const result: Array<{ hostname: string; port: number }> = [];

		for (const route of routes) {
			const id = route['@id'];
			if (typeof id !== 'string' || !id.startsWith(DEVMUX_ID_PREFIX)) continue;

			const hostname = route.match?.[0]?.host?.[0];
			if (!hostname) continue;

			const outerHandle = route.handle?.[0];
			if (!outerHandle || outerHandle.handler !== 'subroute') continue;

			const innerHandle = outerHandle.routes?.[0]?.handle?.[0];
			if (!innerHandle) continue;

			const dial = innerHandle.upstreams?.[0]?.dial;
			if (!dial) continue;

			const portStr = dial.split(':')[1];
			if (!portStr) continue;

			const port = parseInt(portStr, 10);
			if (isNaN(port)) continue;

			result.push({ hostname, port });
		}

		return result;
	}
}

export const caddy = new CaddyManager();

// ── Quick smoke-test when run directly ───────────────────────────────────────
if (process.argv[1] === import.meta.url.slice(7)) {
	(async () => {
		console.log('isAvailable:', await caddy.isAvailable());
		console.log('serverName:', await caddy.getServerName());

		await caddy.registerRoute('test.devmux.localhost', 9876);
		console.log('registered test.devmux.localhost → 9876');

		await caddy.registerRoute('test.devmux.localhost', 9999);
		console.log('re-registered test.devmux.localhost → 9999 (upsert)');

		const routes = await caddy.listRoutes();
		console.log('listRoutes:', JSON.stringify(routes, null, 2));

		await caddy.deregisterRoute('test.devmux.localhost');
		console.log('deregistered test.devmux.localhost');

		const after = await caddy.listRoutes();
		console.log('listRoutes after deregister:', JSON.stringify(after, null, 2));
	})().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
