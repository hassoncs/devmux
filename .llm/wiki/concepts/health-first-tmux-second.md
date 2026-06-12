# Concept: Health-first, tmux-second

## Definition

devmux determines if a service is "running" by checking actual health (port/URL responding) FIRST, then tmux session existence SECOND. The health check is the source of truth; tmux is merely the container.

## Why It Matters

Traditional service managers check "does the process exist?" or "does the tmux session exist?" This creates false positives:
- A tmux session exists but the process crashed 5 minutes ago → manager thinks it's running
- A service was started manually (no tmux) → manager thinks it's not running and tries to start another one

By checking the actual port or HTTP endpoint:
- **Foreign processes are detected**: A node server started manually on port 8787 is recognized as "running" and won't be restarted
- **Dead sessions are caught**: A tmux session with a dead process returns "not healthy" and triggers a restart
- **No false positives**: If the port isn't responding, the service isn't running, period

## How It Manifests

### In `ensureService` (`devmux-cli/src/core/service.ts`, lines 71-100):

```
Step 1: checkHealth(port/URL) 
  → healthy? → return {startedByUs: false} immediately (reuse whatever is running)
  → not healthy? → continue

Step 2: tmux.hasSession(sessionName)
  → exists but unhealthy? → killSession (stale session cleanup)
  → doesn't exist? → create new session

Step 3: poll health until timeout
```

The critical line: `const isHealthy = await checkHealth(autoHealth, sessionName);` is evaluated BEFORE any tmux operations.

### In `getStatus` (`devmux-cli/src/core/service.ts`, lines 143-178):

The `ServiceStatus` object has both `healthy` (from health check) and `tmuxSession` (from tmux check) as independent fields. This allows detecting states like:
- `healthy: true, tmuxSession: null` → running outside tmux
- `healthy: false, tmuxSession: "devmux-..."` → stale session (dead process)
- `healthy: true, tmuxSession: "devmux-..."` → healthy and managed

### In `checkHealth` (`devmux-cli/src/health/checkers.ts`, line 59):

When no health check is configured in the service definition, the fallback is `checkTmuxPane()` — checking if the tmux pane is alive. This is the only case where tmux state contributes to the health decision, and even then it checks the pane's alive status, not just session existence.

### Port conflict detection as a consequence

When a service is healthy but not in tmux, `detectPortConflict()` checks if a foreign process owns the port by comparing CWD. If the foreign process is from a different project, `PortConflictError` is thrown. This is only needed because health-first means we detect foreign running processes.

## Practical Implications

- **Agents can reuse human-started servers**: If a developer already has `pnpm dev` running on port 8787, `devmux ensure api` sees port 8787 is responding and returns "already running"
- **Manual `pnpm dev` works without tmux**: Health checks don't care how the process started — they only care if the port responds
- **Crash recovery is automatic**: Stale tmux sessions (dead processes) are killed and recreated

## Source Attribution

- `devmux-cli/src/core/service.ts` — ensureService (line 71: health check before tmux), getStatus (line 143: independent healthy/tmuxSession fields), detectPortConflict (line 318: handles foreign healthy processes)
- `devmux-cli/src/health/checkers.ts` — checkHealth (line 59: health dispatcher, pane check as fallback)
