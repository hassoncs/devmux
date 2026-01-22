# Getting Started with devmux

This guide walks you through setting up devmux in your project.

## Prerequisites

- Node.js 18+
- tmux installed (`brew install tmux` on macOS)
- A monorepo or project with background services (API, workers, etc.)

## Step 1: Install devmux

```bash
# Global install (recommended for CLI usage)
npm install -g devmux

# Or as a dev dependency
pnpm add -D devmux
```

## Step 2: Create Configuration

### Option A: Auto-discover from Turbo

If you use Turborepo:

```bash
devmux discover turbo
```

This outputs a config based on your `turbo.json` persistent tasks. Review and save:

```bash
devmux discover turbo > devmux.config.json
```

Then edit to add health checks.

### Option B: Start from Template

```bash
devmux init > devmux.config.json
```

### Option C: Write from Scratch

Create `devmux.config.json`:

```json
{
  "version": 1,
  "project": "my-app",
  "services": {
    "api": {
      "cwd": "packages/api",
      "command": "pnpm dev",
      "health": {
        "type": "port",
        "port": 8787
      }
    },
    "web": {
      "cwd": "packages/web",
      "command": "pnpm dev",
      "health": {
        "type": "http",
        "url": "http://localhost:3000"
      }
    }
  }
}
```

## Step 3: Add package.json Scripts

Add these scripts to your root `package.json`:

```json
{
  "scripts": {
    "dev": "devmux run --with api -- pnpm --filter @myapp/web dev",
    "ios": "devmux run --with api -- pnpm --filter @myapp/mobile ios",
    "android": "devmux run --with api -- pnpm --filter @myapp/mobile android",
    "svc:status": "devmux status",
    "svc:ensure": "devmux ensure",
    "svc:stop": "devmux stop",
    "svc:attach": "devmux attach"
  }
}
```

## Step 4: Add Agent Instructions

Create or update `AGENTS.md` in your project root. Copy the template from:
- [AGENTS_TEMPLATE.md](./AGENTS_TEMPLATE.md)

This tells AI agents how to use devmux.

## Step 5: Configure Error Watching (Optional)

DevMux can watch your service logs for errors and capture them for later investigation. Add watch configuration to your `devmux.config.json`:

```json
{
  "version": 1,
  "project": "my-app",
  "watch": {
    "enabled": true,
    "contextLines": 20,
    "dedupeWindowMs": 5000
  },
  "services": {
    "api": {
      "cwd": "packages/api",
      "command": "pnpm dev",
      "health": { "type": "port", "port": 8787 },
      "watch": {
        "enabled": true,
        "include": ["node", "web", "database"]
      }
    }
  }
}
```

**Important:** Pattern sets are opt-in. You must specify which built-in sets to use via `include`.

Then start watching:
```bash
devmux watch start api
```

View captured errors:
```bash
devmux watch queue
```

## Step 6: Test It

```bash
# Check status (should show services as not running)
pnpm svc:status

# Start your dev environment
pnpm dev

# In another terminal, check status
pnpm svc:status
# Should show API as running

# Stop with Ctrl+C in first terminal
# API should be cleaned up automatically
```

## Verifying Agent Compatibility

To test that agents will work correctly:

1. Start a service manually:
   ```bash
   devmux ensure api
   ```

2. Simulate what an agent would do:
   ```bash
   devmux status --json
   devmux ensure api  # Should say "already running"
   ```

3. The agent should see the service and reuse it.

## Configuration Reference

### Health Check Types

**Port check** (recommended for APIs):
```json
{
  "type": "port",
  "port": 8787,
  "host": "127.0.0.1"  // optional, default: 127.0.0.1
}
```

**HTTP check** (for web servers with specific endpoints):
```json
{
  "type": "http",
  "url": "http://localhost:3000/health",
  "expectStatus": 200  // optional, default: 200
}
```

**No check** (not recommended):
```json
{
  "type": "none"
}
```

### Session Naming

Default: `omo-{project}-{service}`

Override per-service:
```json
{
  "services": {
    "api": {
      "sessionName": "my-custom-session-name",
      ...
    }
  }
}
```

Override prefix globally:
```json
{
  "project": "my-app",
  "sessionPrefix": "dev-myapp",  // sessions will be dev-myapp-{service}
  ...
}
```

### Timeouts

```json
{
  "defaults": {
    "startupTimeoutSeconds": 60,  // default: 30
    "remainOnExit": true          // keep tmux session on crash for debugging
  }
}
```

## Troubleshooting

### Service won't start

1. Check if port is in use: `lsof -i :8787`
2. Check tmux session: `tmux attach -t omo-myapp-api`
3. Check config: `cat devmux.config.json`

### Agent keeps restarting services

Make sure agent instructions include checking status first. See [AGENTS_TEMPLATE.md](./AGENTS_TEMPLATE.md).

### Health check fails but service is running

- For port checks: ensure the service binds to `127.0.0.1` or `0.0.0.0`
- For HTTP checks: ensure the URL is correct and returns 2xx/3xx

### tmux session exists but service is dead

devmux handles this automatically—it checks health first, then restarts if needed.

To manually clean up:
```bash
devmux stop api --force
```

## Error Watching

### How it works

When watching is enabled, devmux uses `tmux pipe-pane` to stream service output through a pattern matcher. Matched errors are:
- Captured with surrounding context lines
- Deduplicated within a time window
- Written to `~/.opencode/triggers/queue.jsonl`

### Built-in Pattern Sets

DevMux ships with named pattern sets you explicitly include:

| Set | Patterns | Use for |
|-----|----------|---------|
| `node` | js-error, type-error, unhandled-rejection, oom | Node.js services |
| `web` | http-5xx, http-4xx-important | HTTP APIs |
| `react` | react-error | React apps |
| `nextjs` | webpack-error, hydration-error | Next.js apps |
| `database` | db-error | Database connections |
| `fatal` | fatal (PANIC, SIGSEGV, etc.) | System crashes |
| `python` | exception | Python services |

Example:
```json
{
  "services": {
    "api": {
      "watch": {
        "include": ["node", "web", "database"]
      }
    }
  }
}
```

### Custom Patterns

Define your own pattern sets in the global `watch` config, then include them:

```json
{
  "watch": {
    "patternSets": {
      "my-app": [
        { "name": "my-error", "regex": "\\[MyApp\\] ERROR:", "severity": "error" },
        { "name": "slow-query", "regex": "query took \\d{4,}ms", "severity": "warning" }
      ]
    }
  },
  "services": {
    "api": {
      "watch": {
        "include": ["node", "my-app"]
      }
    }
  }
}
```

Or add inline patterns per-service:

```json
{
  "services": {
    "api": {
      "watch": {
        "include": ["node"],
        "patterns": [
          { "name": "custom-error", "regex": "CustomError:", "severity": "error" }
        ]
      }
    }
  }
}
```

## Next Steps

- Read [WHY.md](./WHY.md) to understand the design philosophy
- Review [AGENTS_TEMPLATE.md](./AGENTS_TEMPLATE.md) for agent integration
- Check the main [README](../README.md) for full CLI reference
