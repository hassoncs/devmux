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
1. **Health checks** - Verify services are actually working
2. **Idempotent operations** - Safe to call `ensure` multiple times
3. **Cleanup tracking** - Only clean up what you started
4. **Convention** - Standard naming (`omo-{project}-{service}`)

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
Human's mental model:     Shared State:           Agent's mental model:
┌─────────────────┐       ┌─────────────────┐     ┌─────────────────┐
│ "I started the  │ ───── │ tmux session:   │ ─── │ "I see the API  │
│  API server"    │       │ omo-myapp-api   │     │  is running"    │
└─────────────────┘       │ Port 8787: ✓    │     └─────────────────┘
                          └─────────────────┘
```

Both human and agent can:
- Query the shared state (`devmux status`)
- Reuse existing services (`devmux ensure api` → "already running")
- See who started what (tmux session exists = managed by devmux)

## Why tmux?

We considered alternatives:

| Approach | Pros | Cons |
|----------|------|------|
| PID files | Simple | Stale on crash, no logs |
| Port checking only | Simple | Can't see logs, can't manage |
| Docker | Isolated, reproducible | Heavy, slow, overkill for dev |
| PM2 | Full-featured | Another daemon, complex |
| **tmux** | Lightweight, attachable, universal | Requires tmux installed |

tmux won because:
1. **Already used by OpenCode** - Agents use `interactive_bash` which creates tmux sessions
2. **Universal** - Available on macOS, Linux, WSL
3. **Attachable** - Can view logs anytime
4. **Lightweight** - No daemon, no config server
5. **Human-friendly** - Developers already know tmux

## The "omo-" Convention

OpenCode (and similar tools) use the prefix `omo-` for tmux sessions. By using the same convention:

```
omo-{project}-{service}
```

Both human scripts and agents naturally discover each other's sessions. No special configuration needed—just follow the convention.

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

## Summary

devmux solves the human-agent coordination problem by:
1. Using tmux as a shared registry of running services
2. Following conventions that both humans and agents understand
3. Making operations idempotent and safe
4. Tracking who started what for proper cleanup

The result: humans and agents can work together without stepping on each other's toes.
