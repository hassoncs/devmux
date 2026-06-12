# RFC: Dashboard Transitional Service States (Yellow Light)

**Status**: Draft
**Author**: Sisyphus (on behalf of slopcade team)
**Date**: 2026-02-14
**Target**: devmux-cli (dashboard)

## 1. Problem Statement

When services are starting up, the dashboard shows them as red (dead) until health checks pass and they flip to green (healthy). This creates a confusing UX — the user sees a wall of red dots and can't tell whether a service is genuinely down or just booting up.

With `devmux ensure web` starting a cascade of dependencies (games-watcher → api → godot → registry → bridge-watch → web), the startup sequence can take 30+ seconds. During this window, the dashboard gives no indication that progress is being made.

**Current behavior:**
- ❌ Red = not healthy (covers both "dead" and "starting up")
- ✅ Green = healthy

**Desired behavior:**
- ❌ Red = dead (no tmux session, not starting)
- 🟡 Yellow/Amber = transitioning (tmux session exists or `ensure` in progress, but health check not yet passing)
- ✅ Green = healthy

## 2. Proposed Solution

Add a third state to the dashboard's service status model: **"starting"** (rendered as yellow/amber).

### 2.1 Detection Strategies

A service should be considered "starting" when any of these are true:

1. **tmux session exists but health check fails** — The session `omo-{project}-{service}` is present in `tmux list-sessions`, but the port/URL health check hasn't passed yet. This is the simplest signal and covers the most common case.

2. **Recent start event** — If the service was started (via `ensure`/`start`) within the last N seconds (configurable, default: 60s), treat health check failures as "starting" rather than "dead". This handles edge cases where the tmux session might not be detected yet.

3. **Dependency chain awareness** — If a service's `dependsOn` services are still starting, mark the dependent service as "waiting" (also yellow). For example, if `api` is starting and `web` depends on `api`, show `web` as yellow with a tooltip like "Waiting for api".

### 2.2 Dashboard UI Changes

**Status dot colors:**
```
● Green (#4caf50)  → Healthy
● Amber (#f59e0b)  → Starting / Waiting for dependencies
● Red   (#f44336)  → Dead / Failed
```

**Tooltip enhancement:**
- Green: `"web — Healthy (port 8085)"`
- Amber: `"web — Starting... (waiting for health check)"` or `"web — Waiting for api"`
- Red: `"web — Not running"`

**Optional: pulse animation** on amber dots to reinforce the "in progress" feel. CSS-only, no JS animation overhead:
```css
.status-dot.starting {
  background: #f59e0b;
  animation: pulse 1.5s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

### 2.3 API Changes

The `/api/status` polling endpoint should return a three-value status enum:

```typescript
type ServiceStatus = "healthy" | "starting" | "stopped";

interface ServiceStatusResponse {
  name: string;
  status: ServiceStatus;
  port?: number;
  detail?: string;  // e.g., "Waiting for api", "Health check pending"
}
```

### 2.4 CLI Changes (optional, low priority)

`devmux status` could also benefit from a third state:

```
✅ api (port 8789): Running
🟡 web (port 8085): Starting...
❌ storybook (port 6007): Not running
```

## 3. Configuration

No new config fields required. The feature uses existing `health` and `dependsOn` fields.

Optional config for tuning:

```json
{
  "defaults": {
    "startupGracePeriodSeconds": 60
  }
}
```

## 4. Implementation Notes

- The tmux session check (`tmux has-session -t <name>`) is cheap and already used by `getAllStatus`.
- The polling interval on the dashboard (currently ~2s) is sufficient to show transitions — no need for WebSocket push for this feature.
- The amber state should be purely visual. It should not affect `ensure` idempotency logic — `ensure` should still check actual health, not dashboard state.

## 5. Open Questions

1. **Should "starting" have a timeout?** After N seconds in amber, should it flip to red with a "startup timeout" message? This would help detect hung services.
2. **Should there be a "stopping" state too?** When `devmux stop` is called, the service could briefly show as amber before going red. Lower priority but symmetrical.
