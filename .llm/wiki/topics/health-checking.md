# Topic: Health Checking

## Purpose

How devmux verifies that a service is actually "running" and ready to accept traffic. Health checks are the primary determinant of service state, not tmux session existence.

## Normative Rules

- Health checks MUST be evaluated BEFORE tmux session existence is checked
- If a service has no health check configured, tmux pane alive status is used as the fallback
- Port health checks MUST use TCP connection attempts with 1-second timeout
- HTTP health checks MUST accept 200 OR 404 as "healthy" when `expectStatus` is 200 (many SPAs return 404 for unknown routes)
- Health check URLs MUST have their port replaced with the resolved port when instance ID causes port offset
- The health check must complete within its timeout to not block startup polling

## How It Works

### Health check types

Defined in `devmux-cli/src/config/types.ts` as `HealthCheckType`:

```typescript
type HealthCheckType =
  | { type: "port"; port: number; host?: string }
  | { type: "http"; url: string; expectStatus?: number }
  | { type: "none" };
```

The `"none"` type uses the same tmux pane fallback as an omitted health check.
It is intended only for fire-and-forget services where no port or HTTP probe is
available.

### checkPort

Located in `devmux-cli/src/health/checkers.ts` (line 5):

Creates a TCP socket connection to the specified port/host. Resolves `true` on `connect` event, `false` on `timeout` (1000ms) or `error`. Socket is always destroyed after resolution — no leaked connections.

### checkHttp

Also in `checkers.ts` (line 27):

Uses native `fetch()` with `AbortSignal.timeout(5000)` for a 5-second timeout. When `expectStatus` is 200, considers both `response.ok` (200-299) AND status 404 as healthy (line 37). This handles SPAs and APIs that return 404 for undefined routes while still being "running".

### checkTmuxPane

In `checkers.ts` (line 45):

Runs `tmux list-panes -t "{session}" -F "#{pane_dead}"`. Returns `true` if output is `"0"` (pane alive), `false` otherwise. This is the fallback when no health check is configured.

### checkHealth

The dispatcher function (`checkers.ts`, line 59):

```typescript
export async function checkHealth(health, sessionName): Promise<boolean>
```

If `health` is undefined or `{ type: "none" }` -> calls
`checkTmuxPane(sessionName)`. Otherwise dispatches to `checkPort` or `checkHttp`
based on `health.type`.

### Health check resolution in service lifecycle

In `devmux-cli/src/core/service.ts`, `resolveHealthCheck()` (line 290) adapts health checks to the resolved port:

- For `port` type: replaces the port with `resolvedPort`
- For `http` type: parses the URL, replaces the port number, reconstructs the URL
- If `resolvedPort` is undefined, returns the original health check unchanged

This is critical for worktree support — the config specifies port 8787, but in a worktree the actual port might be 9549.

### getHealthPort

Helper that extracts the port number from a health check config (`checkers.ts`, line 76). For HTTP checks, it parses the URL to extract the port (or infers 443/80 from protocol). Used in status display.

## Key Files

| File | Role |
|---|---|
| `devmux-cli/src/health/checkers.ts` | Port, HTTP, and tmux pane health checks (88 lines) |
| `devmux-cli/src/core/service.ts` | resolveHealthCheck() adapts health to resolved port |

## Edge Cases

- **HTTP 404 is "healthy"**: Many dev servers return 404 for unknown paths — this is expected behavior for a running server, not an error. The check treats 404 as healthy when expectStatus is 200.
- **Port timeout is 1 second**: TCP connection attempts have a 1000ms timeout. Slow-starting services might briefly appear down during the polling loop.
- **No health = tmux pane**: Services without a health config fall back to checking if the tmux pane is alive. This is less reliable than port checking (a deadlocked process still has an alive pane).
- **HTTP URL port replacement**: The `resolveHealthCheck` function tries to replace the port in HTTP URLs via `URL` object parsing. If parsing fails (malformed URL), it falls back to the original health check.

## Source Attribution

- `devmux-cli/src/health/checkers.ts` — checkPort (line 5), checkHttp (line 27), checkTmuxPane (line 45), checkHealth (line 59), getHealthPort (line 76)
- `devmux-cli/src/core/service.ts` — resolveHealthCheck (line 290)
- `devmux-cli/src/config/types.ts` — HealthCheckType definition (line 1)
