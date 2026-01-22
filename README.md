# @chriscode/devmux

> **tmux-based service management for monorepos.** Shared awareness between humans and AI agents—both can see and reuse running dev servers.

[![npm](https://img.shields.io/npm/v/@chriscode/devmux)](https://www.npmjs.com/package/@chriscode/devmux)
[![Documentation](https://img.shields.io/badge/docs-devmux.pages.dev-blue)](https://devmux.pages.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**[Read the documentation →](https://devmux.pages.dev)**

## Why devmux?

Modern development increasingly involves AI coding assistants (Claude, Copilot, OpenCode, Cursor, etc.) that can run terminal commands. This creates a problem:

**The Problem:**
```
You: pnpm dev          → Starts API server on port 8787
Agent: pnpm dev        → Port conflict! Or kills your server!
```

When both humans and AI agents work in the same codebase, they need **shared awareness** of what's running. Without it:
- Agents restart servers you're actively using
- You lose state when agents kill processes
- Port conflicts cause confusing errors
- No visibility into what the agent started

**The Solution:**

`devmux` uses tmux sessions with predictable naming conventions as a shared registry of running services. Both humans and agents can:
- **See** what's running (`devmux status`)
- **Reuse** existing services (`devmux ensure api` is idempotent)
- **Clean up** only what they started (Ctrl+C cleans up your services, not the agent's)

```
You: devmux run --with api -- pnpm ios
  → Starts API in tmux session "omo-myapp-api"
  → Runs iOS in foreground
  → Ctrl+C kills iOS AND API (because you started it)

Later, Agent: devmux ensure api
  → Checks port 8787... already listening!
  → "✅ api already running"
  → Reuses your server, no restart
```

## Installation

```bash
npm install -g @chriscode/devmux
# or
pnpm add -g @chriscode/devmux
# or in your project
pnpm add -D @chriscode/devmux
```

## Quick Start

### 1. Create config

```bash
# Auto-discover from turbo.json
devmux discover turbo > devmux.config.json

# Or start from template
devmux init > devmux.config.json
```

Edit `devmux.config.json`:

```json
{
  "version": 1,
  "project": "my-app",
  "services": {
    "api": {
      "cwd": "api",
      "command": "pnpm dev",
      "health": { "type": "port", "port": 8787 }
    }
  }
}
```

### 2. Add to package.json

```json
{
  "scripts": {
    "dev": "devmux run --with api -- pnpm --filter app dev",
    "ios": "devmux run --with api -- pnpm --filter app ios",
    "svc:status": "devmux status",
    "svc:ensure": "devmux ensure",
    "svc:stop": "devmux stop",
    "svc:attach": "devmux attach"
  }
}
```

### 3. Add agent instructions

Copy the snippet from [AGENTS.md template](./docs/AGENTS_TEMPLATE.md) to your project's `AGENTS.md`.

### 4. Use it!

```bash
pnpm dev        # API starts in background, cleans up on Ctrl+C
pnpm svc:status # See what's running
```

## How It Works

### Health-first, tmux-second

devmux doesn't just check if a tmux session exists—it checks if the service is actually healthy:

```
1. Is port/URL responding? → "Running" (reuse, even if started outside tmux)
2. tmux session exists but unhealthy? → Restart it
3. Nothing running? → Start new tmux session
```

This means devmux works even if you started a server manually without tmux.

### Session naming convention

Sessions are named `{prefix}-{service}` (or `{prefix}-{instance}-{service}` with multi-worktree):
- Default prefix: `omo-{project}` (e.g., `omo-myapp-api`)
- With instance: `omo-{project}-{instance}-{service}` (e.g., `omo-myapp-feature-x-api`)
- The `omo-` prefix matches OpenCode's convention
- Predictable names let agents discover human-started sessions and vice versa

### Cleanup tracking

When you run `devmux run --with api -- pnpm ios`:
1. devmux checks if API is already healthy
2. If not, starts it and marks "we started this"
3. Runs your command in foreground
4. On Ctrl+C: only stops services "we started"

This prevents accidentally killing the agent's API server when you exit.

## Multi-Worktree Support

When running multiple git worktrees of the same project (common in parallel AI agent workflows), DevMux automatically prevents port and session conflicts.

### How It Works

DevMux detects when you're in a git worktree and automatically:
1. **Adds the worktree name to session names**: `omo-myapp-feature-x-api` instead of `omo-myapp-api`
2. **Applies a deterministic port offset**: Port 8787 becomes 9549 (based on hash of worktree name)
3. **Passes the resolved port via `PORT` env var**: Services can read `$PORT` to use the correct port

### Usage

**Git Worktrees (Zero Config)**
```bash
# Main checkout at /code/myapp
cd /code/myapp
devmux ensure api
# → Session: omo-myapp-api, Port: 8787

# Worktree at /code/myapp-feature-x
cd /code/myapp-feature-x
devmux ensure api
# → Session: omo-myapp-feature-x-api, Port: 9549
```

**Explicit Instance ID**
```bash
# For non-worktree scenarios (CI, multiple checkouts)
DEVMUX_INSTANCE_ID=agent-1 devmux ensure api
DEVMUX_INSTANCE_ID=agent-2 devmux ensure api
```

### Service Configuration

For services to use the DevMux-assigned port, they must read from the `PORT` environment variable:

```json
{
  "services": {
    "api": {
      "command": "node server.js",
      "health": { "type": "port", "port": 8787 }
    }
  }
}
```

DevMux will:
- Set `PORT=8787` (or `PORT=9549` with instance offset)
- Health check the resolved port
- Pass additional env vars: `DEVMUX_PORT`, `DEVMUX_INSTANCE_ID`, `DEVMUX_SERVICE`, `DEVMUX_PROJECT`

### Backwards Compatibility

Without `DEVMUX_INSTANCE_ID` set and outside of a git worktree, DevMux behaves exactly as before—no port offsets, no instance suffix in session names.

## CLI Reference

### `devmux ensure <service>`

Ensure a service is running. **Idempotent**—safe to call multiple times.

```bash
devmux ensure api
# ✅ api already running (if healthy)
# or
# 🚀 Starting api in tmux session: omo-myapp-api
```

Options:
- `--timeout <seconds>` - Startup timeout (default: 30)

### `devmux status`

Show status of all configured services.

```bash
devmux status
# ═══════════════════════════════════════
#        Service Status
# ═══════════════════════════════════════
# ✅ api (port 8787): Running
#    └─ tmux: omo-myapp-api
```

Options:
- `--json` - Output as JSON (for scripts/agents)

### `devmux stop <service|all>`

Stop a service or all services.

```bash
devmux stop api
devmux stop all
devmux stop api --force  # Also kill processes on ports
```

### `devmux attach <service>`

Attach to a service's tmux session to view logs.

```bash
devmux attach api
# Detach with Ctrl+B, then D
```

### `devmux run --with <services> -- <command>`

Run a command with services, cleaning up on exit.

```bash
# Single service
devmux run --with api -- pnpm ios

# Multiple services
devmux run --with api,worker -- pnpm dev

# Keep services running after exit
devmux run --with api --no-stop -- pnpm test
```

### `devmux discover turbo`

Auto-discover services from `turbo.json` persistent tasks.

```bash
devmux discover turbo
# Outputs suggested config based on your turbo.json
```

### `devmux init`

Print a config template to get started.

```bash
devmux init > devmux.config.json
```

### `devmux install-skill`

Install the official DevMux Skill for AI agents to `.claude/skills/devmux/`.

```bash
devmux install-skill
# ✅ Installed DevMux skill to .claude/skills/devmux/
```

## Error Watching (Experimental)

DevMux can watch your service logs for errors and capture them to a queue for later processing. This enables push-based error detection where errors are captured automatically as they happen.

### Quick Start

```bash
# Start watching a service
devmux watch start api

# Check watcher status
devmux watch status

# View captured errors
devmux watch queue

# Stop watching
devmux watch stop api
```

### Watch Commands

| Command | Description |
|---------|-------------|
| `devmux watch start [service]` | Start watching a service (or all if no service specified) |
| `devmux watch stop [service]` | Stop watching a service (or all) |
| `devmux watch status` | Show which services have active watchers |
| `devmux watch queue` | Show pending errors in the queue |
| `devmux watch queue --clear` | Clear all errors from the queue |
| `devmux watch queue --json` | Output queue as JSON |

### Configuration

Add watch configuration to your `devmux.config.json`:

```json
{
  "version": 1,
  "project": "my-app",
  "watch": {
    "enabled": true,
    "outputDir": "~/.opencode/triggers",
    "dedupeWindowMs": 5000,
    "contextLines": 20,
    "patternSets": {
      "my-custom": [
        { "name": "my-app-error", "regex": "MyAppError:", "severity": "error" }
      ]
    }
  },
  "services": {
    "api": {
      "cwd": "api",
      "command": "pnpm dev",
      "health": { "type": "port", "port": 8787 },
      "watch": {
        "enabled": true,
        "include": ["node", "web", "my-custom"]
      }
    },
    "frontend": {
      "cwd": "web",
      "command": "pnpm dev",
      "health": { "type": "port", "port": 3000 },
      "watch": {
        "enabled": true,
        "include": ["node", "react", "nextjs"]
      }
    }
  }
}
```

### Built-in Pattern Sets

DevMux ships with named pattern sets you can include in your services:

| Set | Patterns | Use for |
|-----|----------|---------|
| `node` | `js-error`, `type-error`, `unhandled-rejection`, `oom` | Node.js/JavaScript services |
| `web` | `http-5xx`, `http-4xx-important` | HTTP APIs |
| `react` | `react-error` | React applications |
| `nextjs` | `webpack-error`, `hydration-error` | Next.js applications |
| `database` | `db-error` | Database connections |
| `fatal` | `fatal` (PANIC, SIGSEGV, etc.) | System-level crashes |
| `python` | `exception` | Python services |

**Pattern sets are opt-in.** You must explicitly include them in your service config:

```json
{
  "watch": {
    "include": ["node", "web"]
  }
}
```

### Queue Format

Errors are stored in `~/.opencode/triggers/queue.jsonl` as newline-delimited JSON:

```json
{
  "id": "uuid",
  "timestamp": "2024-01-22T10:00:00Z",
  "source": "devmux:api",
  "service": "api",
  "project": "my-app",
  "severity": "error",
  "pattern": "js-error",
  "rawContent": "Error: Connection refused",
  "context": ["[10:00:00] Starting...", "..."],
  "stackTrace": ["    at ..."],
  "status": "pending",
  "contentHash": "abc123",
  "firstSeen": "2024-01-22T10:00:00Z"
}
```

## Configuration

## Configuration

### Config file locations

devmux searches for config in order:
1. `devmux.config.json`
2. `.devmuxrc.json`
3. `.devmuxrc`
4. `package.json` with `"devmux"` key

### Full schema

```typescript
interface DevMuxConfig {
  version: 1;
  project: string;                    // Used in session naming
  sessionPrefix?: string;             // Override prefix (default: omo-{project})
  defaults?: {
    startupTimeoutSeconds?: number;   // Default: 30
    remainOnExit?: boolean;           // Keep session on crash (default: true)
  };
  services: {
    [name: string]: {
      cwd: string;                    // Working directory (relative to config)
      command: string;                // Command to run in tmux
      health: HealthCheck;            // How to verify service is ready
      sessionName?: string;           // Override full session name
      env?: Record<string, string>;   // Environment variables
      stopPorts?: number[];           // Additional ports to kill on stop
      dependsOn?: string[];           // Services that must be healthy first
    };
  };
}

type HealthCheck =
  | { type: "port"; port: number; host?: string }
  | { type: "http"; url: string; expectStatus?: number }
  | { type: "none" };  // No health check (not recommended)
```

## Programmatic API

```typescript
import { 
  loadConfig,
  ensureService,
  getAllStatus,
  stopService,
  runWithServices 
} from '@chriscode/devmux';

// Load config from current directory
const config = loadConfig();

// Ensure service is running (idempotent)
const result = await ensureService(config, 'api');
console.log(result.startedByUs); // true if we started it

// Get status of all services
const statuses = await getAllStatus(config);
for (const s of statuses) {
  console.log(`${s.name}: ${s.healthy ? 'running' : 'stopped'}`);
}

// Stop a service
stopService(config, 'api');

// Run command with services
const exitCode = await runWithServices(config, ['pnpm', 'test'], {
  services: ['api'],
  stopOnExit: true,
});
```

## Integration with AI Agents

See [docs/AGENTS_TEMPLATE.md](./docs/AGENTS_TEMPLATE.md) for a copy-pasteable snippet to add to your `AGENTS.md`.

The key points for agents:
1. Always check `devmux status` before starting services
2. Use `devmux ensure <service>` (idempotent, won't restart if healthy)
3. Session names follow pattern `omo-{project}-{service}` (or `omo-{project}-{instance}-{service}` in worktrees)
4. In git worktrees, ports are automatically offset to prevent conflicts

## License

MIT
