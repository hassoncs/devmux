# Topic: Portless Proxy

## Purpose

How devmux provides `.localhost` URLs for services on port 80, eliminating the need for port numbers in the browser. Uses Caddy as a system-level reverse proxy.

## Normative Rules

- Proxy hostnames MUST end in `.localhost`
- Proxy MUST only work on the local machine (`*.localhost` resolves to loopback by definition)
- Routes MUST be ephemeral — registered on `ensure`, deregistered on `stop`
- Auto-assigned ports MUST come from the range 4000–4999
- Services without a `health` or `port` can opt into proxy with `"proxy": true` and will get an auto-assigned port
- Services with a fixed port (e.g., Cloudflare Workers on 8787) can add `"proxy": true` and keep their existing port
- The `{{PORT}}` template placeholder MUST be replaced in both the command string and env vars
- `proxy": false` MUST explicitly opt a service OUT of proxying
- Hostname pattern MUST be configurable via `proxy.hostnamePattern` but still must end in `.localhost`
- React Native / Expo Metro ports (8081, 19000–19002) SHOULD NOT be proxied — too tightly coupled to native tooling

## How It Works

### Architecture

```
Browser → http://api.my-app.localhost
       → Caddy (port 80, macOS LaunchDaemon)
       → devmux auto-assigned port (e.g., 4217)
       → your service
```

Caddy runs as a system LaunchDaemon on port 80. Devmux manages routes dynamically via Caddy's admin API at `http://localhost:2019`.

### CaddyManager

In `devmux-cli/src/proxy/caddy.ts` (285 lines):

**isAvailable()** (line 95): Checks if Caddy admin API responds at `http://localhost:2019/config/`.

**getServerName()** (line 108): Discovers the first HTTP server name from Caddy config (e.g., `"srv0"`). Creates a default server if none exists. Caches the result per instance.

**registerRoute()** (line 151): Full config read-modify-write cycle with duplicate-ID convergence:
1. Reads the entire Caddy config via `GET /config/`
2. Filters out any existing route with the same `@id` (idempotent upsert)
3. Prepends the new route to the routes array
4. POSTs the entire config to `/load`
5. If Caddy rejects the write with a duplicate route ID, re-reads managed routes and treats the operation as success when the existing hostname already points to the requested port; otherwise retries once and then throws

Route IDs follow the pattern `devmux_{hostname_with_dots_and_hyphens_as_underscores}`.

**deregisterRoute()** (line 198): `DELETE /id/{routeId}`. Swallows 404 (idempotent — route might already be gone).

**listRoutes()** (line 213): Reads all routes from Caddy, filters for `@id` starting with `devmux_`, and returns `{hostname, port}` pairs.

### Proxy Manager

In `devmux-cli/src/proxy/manager.ts` (160 lines):

**isServiceProxied()** (line 56): A service is proxied if:
- Proxy is enabled in config (`config.proxy.enabled === true`)
- Service does NOT have `proxy: false`
- Service has a port/health OR has `proxy: true`

**getServiceHostname()** (line 69): Applies the hostname pattern (default: `{service}.{project}.localhost`), then validates via `parseHostname()`.

**parseHostname()** (line 14): Validates hostname rules:
- Strips `http://`/`https://` prefix, takes hostname part
- Appends `.localhost` if the name has < 3 parts but isn't `.localhost` alone
- Rejects consecutive dots, invalid characters, non-`.localhost` endings

**registerRoute() / deregisterRoute()** (line 89/99): Delegates to CaddyManager with the computed hostname.

**ensureProxyRunning()** (line 107): Checks Caddy availability. If down, it first tries to revive the managed LaunchDaemon via `launchctl kickstart`, then `sudo -n launchctl kickstart`, and finally `sudo -n launchctl bootstrap system <plist>` for the booted-out state created by `devmux proxy stop`, before throwing with a doctor report.

**findFreePort()** (line 136): Tries 50 random ports in range 4000–4999, then falls back to sequential scan. Uses `createServer().listen()` to test availability.

### Integration with service lifecycle

In `devmux-cli/src/core/service.ts`:

- During `ensureService`: If proxied, calls `ensureProxyRunning()`, finds a free port if needed, auto-creates a port health check, and registers the Caddy route after the service is healthy
- During `stopService`: Calls `deregisterRoute()` before killing the tmux session
- Template substitution: `{{PORT}}`, `{{INSTANCE}}`, `{{SERVICE}}`, `{{PROJECT}}` are replaced in both the command string and env vars

### Hostname pattern

Default: `{service}.{project}.localhost` (e.g., `api.my-app.localhost`)

Override example:
```json
{ "proxy": { "enabled": true, "hostnamePattern": "{service}.localhost" } }
```

This would produce `api.localhost` instead.

### System setup

From `docs/PORTLESS_PROXY.md`:
1. Install Caddy: `brew install caddy`
2. Create minimal Caddyfile at `/usr/local/etc/caddy/Caddyfile`
3. Install LaunchDaemon plist at `/Library/LaunchDaemons/dev.devmux.caddy.plist`
4. Load the daemon: `sudo launchctl load -w ...`

One-time commands: `sudo devmux proxy setup --apply` and `devmux proxy doctor`.

**Why not `pf` redirect?** macOS `pf` cannot redirect loopback-originated traffic (browser → 127.0.0.1). Caddy as LaunchDaemon is the same approach as Laravel Valet.

## Key Files

| File | Role |
|---|---|
| `devmux-cli/src/proxy/caddy.ts` | Caddy admin API client (register/deregister/list routes) |
| `devmux-cli/src/proxy/manager.ts` | Proxy enable logic, hostname generation, port allocation |
| `devmux-cli/src/proxy/system.ts` | System setup, doctor diagnostics |
| `docs/PORTLESS_PROXY.md` | Full system setup documentation |
| `devmux-cli/src/core/service.ts` | Proxy integration in ensure/stop |

## Edge Cases

- **Caddy CSRF**: Node.js 24+ fetch sends `sec-fetch-mode: cors`, triggering Caddy's CSRF check. The code works around this by explicitly setting the `Origin` header to match the admin listen address (`caddy.ts`, lines 88-91).
- **Concurrent same-route ensure**: Two `devmux ensure` calls can both try to upsert the same proxied dependency. `registerRoute()` now treats duplicate-ID errors as success when another caller already converged the same hostname → port, which keeps overlapping `ensure` calls idempotent.
- **Route upsert**: Registering the same hostname twice deletes the old route first — this ensures port changes between restarts are reflected.
- **No auto-pinning**: Auto-assigned ports are NOT pinned between restarts. Each `ensure` may get a different port from the 4000–4999 range.
- **Ephemeral routes**: Routes disappear when Caddy restarts. Devmux re-registers them on each `ensure`.
- **Port template in commands**: `{{PORT}}` must appear in the command string for services that accept port args. If the service reads `$PORT` from env instead, the template is still substituted in env vars.
- **Lazy start is revive-only**: Devmux will try to wake an already-installed managed proxy, but it does not auto-run `proxy setup` or block on an interactive `sudo` prompt during `ensure`.

## Source Attribution

- `devmux-cli/src/proxy/caddy.ts` — CaddyManager class (line 74), isAvailable (line 95), getServerName (line 108), registerRoute (line 151), deregisterRoute (line 198), listRoutes (line 213)
- `devmux-cli/src/proxy/manager.ts` — isServiceProxied (line 56), getServiceHostname (line 69), parseHostname (line 14), registerRoute (line 89), deregisterRoute (line 99), ensureProxyRunning (line 107), findFreePort (line 136)
- `devmux-cli/src/core/service.ts` — Proxy integration in ensureService (lines 54, 67-69, 93-96, 128-130), stopService (lines 204-208)
- `docs/PORTLESS_PROXY.md` — System setup, architecture, hostname pattern docs
