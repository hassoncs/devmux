# Concept: Idempotent Ensure

## Definition

The `ensure` operation can be called repeatedly with the same arguments and produces the same result: a healthy service. If the service is already healthy, it returns immediately without restarting, killing, or modifying anything.

## Why It Matters

In a multi-agent environment, multiple agents (or a human and an agent) may independently decide "I need the API running." Without idempotency:
- Agent A starts API on port 8787
- Agent B also starts API → port conflict OR Agent B kills Agent A's process
- Developer loses their server state

With idempotent ensure:
- Agent A calls `devmux ensure api` → starts the service
- Agent B calls `devmux ensure api` → sees port 8787 is healthy → returns immediately with "already running"

## How It Manifests

### The idempotency gate: health check (`devmux-cli/src/core/service.ts`, line 71):

```typescript
const isHealthy = await checkHealth(autoHealth, sessionName);
if (isHealthy) {
  // ... detect port conflict, log URLs ...
  return { serviceName, startedByUs: false, sessionName };
}
```

This is the idempotency gate. If the service is healthy (port responding), the function returns immediately. It does not:
- Check if the tmux session matches our expected name (health is sufficient)
- Kill and restart the service
- Re-register proxy routes if they already exist (deregister + register is idempotent at the Caddy level)

### Dependency resolution is also idempotent

Before the main service is checked, its dependencies are ensured recursively (`devmux-cli/src/core/service.ts`, lines 38-47). Since `ensureService` is idempotent, ensuring dependencies is also idempotent — if a dependency is already healthy, it returns without action.

### Proxy route registration is idempotent

When `registerRoute()` is called in Caddy, it first deletes any existing route with the same ID, then creates the new one (`devmux-cli/src/proxy/caddy.ts`, lines 151-193). This means calling `ensure` twice registers the same route twice without duplicates.

### Stale session cleanup is idempotent

If a tmux session exists but is unhealthy, it's killed before creating a new one (`devmux-cli/src/core/service.ts`, lines 103-106). `tmux.killSession()` silently catches errors, so killing an already-dead session is a no-op.

### Return value semantics

The `startedByUs` boolean tells the caller whether THIS invocation started the service:
- `startedByUs: false` → service was already healthy (we reused it)
- `startedByUs: true` → we started it just now

This is critical for `runWithServices` (`devmux-cli/src/core/run.ts`, lines 52-57), which only stops services where `startedByUs === true` on cleanup.

### Timeout and polling

Idempotency doesn't mean instant — if the service is starting but not yet healthy, `ensureService` polls for up to `timeout` seconds (default 30). Each poll calls `checkHealth`. Once healthy, it returns. If the timeout is reached without health, it throws.

## Practical Implications

- **Safe in automation scripts**: Agents can call `devmux ensure api` at the start of any task without checking first
- **Safe in loops**: Repeated calls in a CI loop won't restart the service each time
- **`run --with` cleanup is precise**: Only stops services this invocation started, not pre-existing ones, because `startedByUs` tracks ownership

## Source Attribution

- `devmux-cli/src/core/service.ts` — ensureService idempotency gate (line 71), dependency resolution (line 38), stale session cleanup (line 103), return value (line 100/135)
- `devmux-cli/src/core/run.ts` — runWithServices cleanup tracking (lines 52-57, 100-117)
- `devmux-cli/src/proxy/caddy.ts` — registerRoute idempotency via delete-then-create (line 151)
