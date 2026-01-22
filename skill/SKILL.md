# DevMux Skill

> **Skill for AI Agents**: Managing persistent development environments via `devmux`.

## Context

You are working in a `devmux`-enabled repository. This means:
1. **Shared Awareness**: Human developers and AI agents share the same running servers.
2. **Persistence**: Servers run in background `tmux` sessions, surviving your session.
3. **Safety**: You must NOT kill services randomly. You must reuse existing ones.
4. **Error Watching**: Errors can be automatically captured from service logs for investigation.

## Commands (The "DevMux API")

### Service Management

| Goal | Command | Behavior |
|------|---------|----------|
| **Start a service** | `devmux ensure <name>` | **Idempotent**. Starts if stopped. Does nothing if healthy. |
| **Check status** | `devmux status` | Lists all services, ports, and health status. |
| **Read logs** | `devmux attach <name>` | Shows live logs (Press `Ctrl+B, D` to detach). |
| **Stop service** | `devmux stop <name>` | **Only if necessary**. Prefer leaving running. |

### Error Watching

| Goal | Command | Behavior |
|------|---------|----------|
| **Start watching** | `devmux watch start <name>` | Monitors logs for errors. Captures to queue. |
| **Stop watching** | `devmux watch stop <name>` | Stops monitoring. |
| **Check watchers** | `devmux watch status` | Shows which services are being watched. |
| **View errors** | `devmux watch queue` | Shows pending errors waiting for investigation. |
| **Clear queue** | `devmux watch queue --clear` | Clears all captured errors. |

## Rules of Engagement (CRITICAL)

### 1. The "Check First" Rule
**Before** running `pnpm dev` or `npm start`, you MUST check if it's managed by devmux:
```bash
devmux status
```
* If listed: **USE DEVMUX**. Run `devmux ensure <name>`.
* If not listed: Run normally.

### 2. The "Idempotency" Rule
**NEVER** check "is it running?" manually. Just run:
```bash
devmux ensure api
```
* If it's running: It returns "✅ api already running" (Instant).
* If it's stopped: It starts it and **waits for health checks** (Port open).
* **Trust the `ensure` command.**

### 3. The "Dependency" Rule
Services have dependencies. `web` might need `api`.
* **Old Way**: "Start API, wait 10s, Start Web."
* **DevMux Way**: `devmux ensure web`. (It handles the graph and health checks automatically).

### 4. The "Error Queue" Rule
If errors are detected from services, check the queue:
```bash
devmux watch queue
```
* Errors are automatically captured with context (surrounding log lines).
* Stack traces are extracted when possible.
* Duplicate errors are deduplicated.

### 5. The "Logs" Rule
If a service fails, **DO NOT** try to run it manually to see errors.
1. `devmux ensure <name>` (It captures startup errors).
2. `devmux attach <name>` (View full session logs).
3. `devmux watch queue` (View captured errors if watching is enabled).

## Session Naming

Sessions follow the pattern: `omo-{project}-{service}`.
* Example: `omo-waypoint-api`
* You can use standard `tmux` commands if needed: `tmux capture-pane -t omo-waypoint-api -p`

## Error Queue Format

Errors in the queue include:
- **Service**: Which service produced the error
- **Pattern**: What type of error was detected (js-error, type-error, fatal, etc.)
- **Severity**: info, warning, error, or critical
- **Context**: Lines before the error for debugging
- **Stack trace**: Extracted if available

## Built-in Pattern Sets

Pattern sets are **opt-in** via `include` in the service watch config:

| Set | Use for |
|-----|---------|
| `node` | Node.js/JavaScript (errors, types, OOM) |
| `web` | HTTP APIs (5xx, 4xx errors) |
| `react` | React apps (component errors) |
| `nextjs` | Next.js (webpack, hydration) |
| `database` | DB connections (refused, deadlock) |
| `fatal` | System crashes (PANIC, SIGSEGV) |
| `python` | Python (exceptions, tracebacks) |

Example config:
```json
{
  "watch": { "include": ["node", "web"] }
}
```

## Verification

After starting a service, `devmux` guarantees it is **healthy** (port is listening). You do NOT need to write a loop to check `curl localhost:port`. `devmux ensure` does not return until the service is ready.

## Setup & Configuration

If the user asks to set up DevMux or configure a new project, read the guide at:
`references/SETUP.md`

It explains how to correctly configure `devmux.config.json` and `package.json`.
