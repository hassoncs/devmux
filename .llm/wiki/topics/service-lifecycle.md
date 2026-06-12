# Topic: Service Lifecycle Management

## Purpose

Core service operations: ensure a service is running, check its status, stop it, restart it, or attach to its tmux session. These are the primary operations the CLI exposes.

## Normative Rules

- `ensure` MUST be idempotent — calling it on an already-healthy service returns immediately without side effects
- `ensure` MUST resolve dependencies recursively before starting the target service
- Circular dependencies MUST be detected and throw an error
- `stop` MUST deregister proxy routes before killing tmux sessions
- `run --with` MUST track which services "we started" and only clean up those on exit
- All operations MUST work with the resolved config instance (including worktree instance IDs)

## How It Works

### ensureService (idempotent start-or-reuse)

Located in `devmux-cli/src/core/service.ts`, the `ensureService()` function:

1. **Detects circular dependencies** via a `_dependencyStack` set (line 29)
2. **Ensures dependencies** recursively by calling `ensureService` for each entry in `service.dependsOn` (lines 38-47)
3. **Resolves port** — uses config port, or finds a free port 4000-4999 for proxied services without explicit ports (lines 56-59)
4. **Resolves health check** — adapts port/HTTP health checks to the resolved port if needed (line 61)
5. **Checks health first** — if the port/URL is responding, returns `{startedByUs: false}` immediately (lines 71-100)
6. **Detects port conflicts** — if healthy but no tmux session, checks if a foreign process owns the port (lines 75-80)
7. **Cleans stale sessions** — if tmux session exists but health check failed, kills the session (lines 103-106)
8. **Starts new session** — creates tmux session with resolved command and env vars (lines 112-117)
9. **Sets remain-on-exit** — keeps the session visible after process exits (lines 119-120)
10. **Polls for readiness** — loops up to `timeout` seconds checking health every 1 second (lines 123-138)
11. **Registers proxy route** — if proxied, registers the hostname→port mapping in Caddy (lines 128-130)

### getStatus

Checks health via the configured health checker, checks tmux session existence, and returns a `ServiceStatus` object. Also detects port conflicts when a service is healthy but not managed by tmux (`devmux-cli/src/core/service.ts`, lines 143-178).

### stopService

Deregisters proxy routes (if applicable), kills tmux session, and optionally kills processes on specific ports (`devmux-cli/src/core/service.ts`, lines 189-235). The `killPorts` option also kills processes on `service.stopPorts` if defined.

### runWithServices

Located in `devmux-cli/src/core/run.ts`. Runs a foreground command with services:

1. Iterates requested services, calling `ensureService` only if not already healthy
2. Tracks services "started by us" in a `startedByUs` array
3. Optionally starts the dashboard server
4. Prints a "Service URLs" summary
5. Registers cleanup on SIGINT, SIGTERM, and exit
6. On exit: only stops services from the `startedByUs` array, not pre-existing ones
7. Spawns the foreground command with `stdio: "inherit"` and `shell: true`

### restartService

Calls `stopService` then `ensureService` sequentially (`devmux-cli/src/core/service.ts`, lines 247-254).

### attachService

Opens an interactive `tmux attach` to the service's session (`devmux-cli/src/core/service.ts`, lines 256-271).

### Port conflict detection

When a service reports healthy but lacks a tmux session, `detectPortConflict()` checks if a foreign process owns the port. It compares the process's CWD against the config root — if the CWD matches or is a subdirectory, it's considered "ours" and no conflict is raised (`devmux-cli/src/core/service.ts`, lines 318-358).

## Key Files

| File | Role |
|---|---|
| `devmux-cli/src/core/service.ts` | ensure, status, stop, restart, attach, port conflict detection |
| `devmux-cli/src/core/run.ts` | runWithServices with cleanup tracking |
| `devmux-cli/src/utils/process.ts` | port conflict detection utilities |

## Edge Cases

- **Foreign healthy process**: If a service is running outside tmux (e.g., manually started), `ensure` returns `startedByUs: false` and does NOT restart it
- **Stale tmux session**: If a tmux session exists but the process is dead (health check fails), the session is killed and recreated
- **Circular dependencies**: Two services depending on each other will throw `Circular dependency detected`
- **Port conflict on ensure**: If a process from a different CWD owns the expected port, `PortConflictError` is thrown with PID and command details

## Source Attribution

- `devmux-cli/src/core/service.ts` — ensureService (line 23), getStatus (line 143), stopService (line 189), restartService (line 247), attachService (line 256), detectPortConflict (line 318), resolveHealthCheck (line 290), buildServiceEnv (line 384)
- `devmux-cli/src/core/run.ts` — runWithServices (line 27), resolveDashboardConfig (line 17)
- `devmux-cli/src/config/types.ts` — ServiceStatus interface (line 81), PortConflictInfo (line 71)
