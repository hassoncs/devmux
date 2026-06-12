# Why devmux?

## The Problem: Human-Agent Coordination

As AI coding assistants become more capable, developers increasingly work alongside agents that can execute terminal commands. This creates a coordination problem that didn't exist before.

### The Old World (Solo Developer)

```bash
# You start your dev server
pnpm dev
# Server runs on port 8787
# You're the only one who can start/stop it
# Everything is simple
```

### The New World (Human + Agent)

```
Terminal 1 (You):
$ pnpm dev
Server running on port 8787...

Terminal 2 (Agent, 5 minutes later):
$ pnpm dev
Error: Port 8787 already in use!
# Or worse: kills your server and restarts
```

The agent doesn't know you already started the server. You don't know if the agent started something. There's no shared awareness.

## Real-World Pain Points

### 1. Duplicate Server Starts

Agent tries to test something, runs `pnpm dev`, and either:
- Gets a port conflict error
- Kills your running server (if scripts include `kill` commands)
- Starts a duplicate on a different port (if port fallback is configured)

### 2. Lost State

You're debugging something, have console logs open, server has state. Agent restarts the server. State is gone.

### 3. Resource Waste

Multiple instances of the same server running, consuming memory and CPU.

### 4. Confusion

"Is the server running? Did I start it or did the agent? Which port is it on?"

## The Solution: Shared Awareness via tmux

tmux provides:
1. **Named sessions** - Predictable, discoverable identifiers
2. **Detached processes** - Survive terminal closes
3. **Attachability** - Anyone can view logs

devmux adds:
1. **Health checks** - Verify services are actually working, not just that a tmux session exists
2. **Idempotent operations** - Safe to call `ensure` multiple times
3. **Cleanup tracking** - Only clean up what you started
4. **Worktree port offsetting** - Parallel git worktrees get different port ranges automatically

## How It Creates Shared Awareness

### Before devmux

```
Human's mental model:     Agent's mental model:
┌─────────────────┐       ┌─────────────────┐
│ "I started the  │       │ "I don't know   │
│  API server"    │       │  what's running"│
└─────────────────┘       └─────────────────┘
         ↓                         ↓
    (no connection)          (blind action)
```

### After devmux

```
Human's mental model:     Shared State:              Agent's mental model:
┌─────────────────┐       ┌─────────────────────┐   ┌─────────────────┐
│ "I started the  │ ───── │ tmux session:       │ ─ │ "I see the API  │
│  API server"    │       │ devmux-myapp-api    │   │  is running"    │
└─────────────────┘       │ Port 8787: ✓        │   └─────────────────┘
                          └─────────────────────┘
```

Both human and agent can:
- Query the shared state (`devmux status`)
- Reuse existing services (`devmux ensure api` → "already running")
- See who started what (tmux session exists = managed by devmux)

## Comparison with Alternatives

The first thing people ask is: "why not just use X?" These are the honest answers.

### overmind — closest prior art

[overmind](https://github.com/DarthSim/overmind) is the most direct comparison: it's also tmux-based, also manages multiple processes, and predates devmux. If you already use overmind and are happy with it, you may not need devmux.

Where they differ:

| Capability | overmind | devmux |
|---|---|---|
| Process model | Procfile-based | JSON config |
| Health checking | None (starts = running) | Port or HTTP health checks before "ready" |
| Idempotency | No — fails if already running | Yes — `ensure` is safe to call any number of times |
| Cleanup tracking | No | Tracks which process started which service for selective teardown |
| Worktree port offsetting | No | Deterministic port offset per git worktree |
| Agent-readable status | No | `devmux status --json` |
| Config discovery | Procfile at cwd | Walks up to project root |
| Maturity | Stable, widely used | Newer, fewer production miles |

If your workflow is human-only, overmind's Procfile simplicity is a genuine advantage. devmux's extra machinery pays off when AI agents join the workflow.

### foreman

[foreman](https://github.com/ddollar/foreman) is the original Procfile runner. It runs processes in the foreground (not tmux), so there's no shared state and no way for an agent to discover or reuse running services. Good for CI; not designed for the human-agent coordination problem.

### mprocs

[mprocs](https://github.com/pvolok/mprocs) is a TUI-based process manager with a clean interface. Runs processes in pseudo-terminals. No health checks, no idempotency, no agent-readable API.

### process-compose

[process-compose](https://github.com/F1bonacc1/process-compose) is the most full-featured: health checks, dependency ordering, readiness probes, and a web API. It's the closest to devmux in terms of functionality.

| Capability | process-compose | devmux |
|---|---|---|
| Health checks | Yes | Yes |
| Dependency ordering | Yes | Yes (`dependsOn`) |
| tmux sessions | No — own TUI | Yes — standard tmux |
| Agent reuse | Requires API polling | Discoverable via tmux session names |
| Cleanup tracking | No | Yes |
| Worktree port offsetting | No | Yes |
| Platform | Cross-platform | macOS/Linux |

process-compose is a strong choice for complex orchestration. devmux's bet is that tmux session naming is a more universal coordination primitive for AI agents than a per-tool HTTP API.

### pm2

[pm2](https://pm2.keymetrics.io/) is a production process manager. It has a daemon, persists process lists across reboots, and is optimized for server deployment, not local development. It's heavier than necessary for the dev workflow problem.

### docker compose

[docker compose](https://docs.docker.com/compose/) provides isolation and reproducibility at the cost of overhead (image builds, volume mounts, network setup). For teams that already Dockerize their dev environment, it's a complete solution. For teams that don't, devmux has near-zero overhead.

| Approach | Pros | Cons |
|----------|------|------|
| overmind | tmux-based, Procfile ecosystem, stable | No health checks, no idempotency, no agent API |
| foreman | Simple Procfile, CI-friendly | Foreground only, no shared state |
| mprocs | Nice TUI | No health checks, no agent API |
| process-compose | Full-featured, health checks, web API | No tmux sessions, no cleanup tracking |
| pm2 | Production-grade, daemon | Overkill for dev, not agent-friendly |
| docker compose | Isolated, reproducible | Heavy, slow for inner-loop dev |
| **devmux** | tmux sessions as shared registry, health-first idempotency, cleanup tracking, worktree port offsetting | macOS/Linux only, newer/less battle-tested |

## Key Design Decisions

### 1. Health-first, tmux-second

We don't just check if a tmux session exists. We check if the service is actually healthy:

```
Port responding? → Service is running (even if started outside tmux)
```

This handles the case where someone started the server manually without devmux.

### 2. Idempotent ensure

`devmux ensure api` is always safe to call:
- Already running → reuse
- Not running → start

Agents can call it without worrying about duplicates.

### 3. Cleanup tracking

When you run `devmux run --with api -- pnpm ios`:
- devmux remembers "I started the API"
- On Ctrl+C, it stops the API
- If the API was already running (agent started it), it leaves it alone

This prevents humans from accidentally killing agent-started services.

### 4. Worktree port offsetting

Running multiple git worktrees of the same project (common with parallel AI agents) automatically gets different port ranges based on a hash of the worktree path. No manual port configuration required.

## Summary

devmux solves the human-agent coordination problem by:
1. Using tmux as a shared registry of running services
2. Making operations idempotent and health-verified
3. Tracking who started what for proper cleanup
4. Automatically handling multi-worktree port conflicts

The result: humans and agents can work together without stepping on each other's toes.
