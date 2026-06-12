# devmux Wiki — Index

tmux-based dev service manager for monorepos. Shared awareness between humans and AI agents.

## Structure

### Start Here
- [CONTEXT.md](../CONTEXT.md) — Overview, task quick-start, architecture

### Writing Rules
- [schema.md](../schema.md) — Normative rules vs implementation details

### Topics (functional areas)
- [topics/service-lifecycle.md](topics/service-lifecycle.md) — ensure/start/stop/restart idempotent operations
- [topics/tmux-integration.md](topics/tmux-integration.md) — session creation, pipe-pane, env injection
- [topics/health-checking.md](topics/health-checking.md) — port-based and HTTP-based health checks
- [topics/configuration-resolution.md](topics/configuration-resolution.md) — multi-location config, worktree isolation
- [topics/portless-proxy.md](topics/portless-proxy.md) — Caddy integration, .localhost URLs
- [topics/error-watching-telemetry.md](topics/error-watching-telemetry.md) — log pattern matching, WebSocket telemetry

### Concepts (abstract ideas)
- [concepts/health-first-tmux-second.md](concepts/health-first-tmux-second.md) — health checks before tmux session existence
- [concepts/idempotent-ensure.md](concepts/idempotent-ensure.md) — safe repeated calls without side effects
- [concepts/instance-isolation.md](concepts/instance-isolation.md) — git worktree unique sessions and port offsets
