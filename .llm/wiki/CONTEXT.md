# devmux — Context

## Agent Start

**devmux** is a tmux-based service manager for monorepos. It solves the problem of humans and AI agents conflicting over running dev servers by using tmux sessions as a shared registry.

- **CLI package**: `@chriscode/devmux` (TypeScript, tsup bundler, citty CLI)
- **Source root**: `devmux-cli/src/`
- **Other packages**: `@chriscode/devmux-telemetry-server`, `@chriscode/devmux-telemetry-client`
- **Repo**: project root (wherever you cloned it)

### Core problem solved

```
You: pnpm dev          → Starts API server on port 8787
Agent: pnpm dev        → Port conflict! Or kills your server!
```

devmux prevents this by:
1. Using predictable tmux session names as a shared registry
2. Checking actual port/HTTP health before deciding to start
3. Tracking which services "we started" so cleanup only stops ours

## Tasks

| If you want to... | Read this file |
|---|---|
| Understand how ensure/start/stop work | [topics/service-lifecycle.md](topics/service-lifecycle.md) |
| See how tmux sessions are created and managed | [topics/tmux-integration.md](topics/tmux-integration.md) |
| Understand how services are verified as "running" | [topics/health-checking.md](topics/health-checking.md) |
| Configure services, understand config resolution | [topics/configuration-resolution.md](topics/configuration-resolution.md) |
| Set up portless .localhost URLs | [topics/portless-proxy.md](topics/portless-proxy.md) |
| Set up error watching from service logs | [topics/error-watching-telemetry.md](topics/error-watching-telemetry.md) |
| Understand why health checks come before tmux | [concepts/health-first-tmux-second.md](concepts/health-first-tmux-second.md) |
| Understand why ensure is safe to call repeatedly | [concepts/idempotent-ensure.md](concepts/idempotent-ensure.md) |
| Understand git worktree port/session isolation | [concepts/instance-isolation.md](concepts/instance-isolation.md) |
| See full CLI reference | [README.md](../../README.md) |
| See agent instructions | [docs/AGENTS_TEMPLATE.md](../../docs/AGENTS_TEMPLATE.md) |

## Architecture Overview

```
CLI Entry (citty)
  │
  ├── Config Layer
  │   ├── loader.ts       — find config, resolve paths, session names, ports
  │   ├── types.ts        — TypeScript interfaces for all config shapes
  │   └── worktree.ts     — git worktree detection, instance ID resolution
  │
  ├── Core Layer
  │   ├── service.ts      — ensure, status, stop, restart, attach
  │   └── run.ts          — runWithServices with cleanup tracking
  │
  ├── tmux Layer
  │   └── driver.ts       — new-session, kill-session, attach, remain-on-exit
  │
  ├── Health Layer
  │   └── checkers.ts     — TCP port check, HTTP check, tmux pane check
  │
  ├── Proxy Layer
  │   ├── manager.ts      — port allocation, hostname generation, route lifecycle
  │   ├── caddy.ts        — Caddy admin API client (register/deregister routes)
  │   └── system.ts       — system setup, doctor diagnostics
  │
  ├── Watch Layer
  │   ├── watcher.ts      — stdin line reader, pattern matching, stack accumulation
  │   ├── patterns.ts     — builtin pattern sets, regex matching
  │   ├── deduper.ts      — content hash ring buffer, time-window deduplication
  │   ├── queue.ts        — JSONL file writer/reader
  │   └── manager.ts      — start/stop watcher processes
  │
  ├── Telemetry Layer
  │   ├── server.ts       — WebSocket server for browser/app logs
  │   └── client.ts       — Client SDK for browser/RN apps
  │
  └── Utils
      ├── port.ts         — djb2 hash port offset calculation
      ├── process.ts      — port conflict detection, process killing
      └── lock.ts         — process locking
```

## Key Design Decisions

- **Health-first, tmux-second**: Check port/URL responding before checking tmux session existence
- **Idempotent operations**: `ensure` is safe to call repeatedly — returns immediately if already healthy
- **Cleanup ownership**: `run --with` only stops services "we started", not pre-existing ones
- **Predictable naming**: `devmux-{project}[-{instance}]-{service}` so agents and humans can discover each other's sessions
- **Worktree isolation**: djb2 hash of worktree name produces deterministic port offsets

## Commands

```bash
pnpm cli:build          # Build CLI only
pnpm cli:dev            # Watch mode for CLI
pnpm test               # All tests
pnpm type-check         # TypeScript checking
```

## Config Locations (searched in order)

1. `devmux.config.json`
2. `.devmuxrc.json`
3. `.devmuxrc`
4. `package.json` with `"devmux"` key

See [topics/configuration-resolution.md](topics/configuration-resolution.md) for full resolution logic.
