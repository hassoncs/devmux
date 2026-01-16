# DevMux Skill

> **Skill for AI Agents**: Managing persistent development environments via `devmux`.

## 🧠 Context
You are working in a `devmux`-enabled repository. This means:
1.  **Shared Awareness**: Human developers and AI agents share the same running servers.
2.  **Persistence**: Servers run in background `tmux` sessions, surviving your session.
3.  **Safety**: You must NOT kill services randomly. You must reuse existing ones.

## 🛠️ Commands (The "DevMux API")

| Goal | Command | Behavior |
|------|---------|----------|
| **Start a service** | `devmux ensure <name>` | **Idempotent**. Starts if stopped. Does nothing if healthy. |
| **Check status** | `devmux status` | Lists all services, ports, and health status. |
| **Read logs** | `devmux attach <name>` | Shows live logs (Press `Ctrl+C` to detach/exit logs, NOT kill). |
| **Stop service** | `devmux stop <name>` | **Only if necessary**. Prefer leaving running. |

## 🚦 Rules of Engagement (CRITICAL)

### 1. The "Check First" Rule
**Before** running `pnpm dev` or `npm start`, you MUST check if it's managed by devmux:
```bash
devmux status
```
*   If listed: **USE DEVMUX**. Run `devmux ensure <name>`.
*   If not listed: Run normally.

### 2. The "Idempotency" Rule
**NEVER** check "is it running?" manually. Just run:
```bash
devmux ensure api
```
*   If it's running: It returns "✅ api already running" (Instant).
*   If it's stopped: It starts it and **waits for health checks** (Port 8787 open).
*   **Trust the `ensure` command.**

### 3. The "Dependency" Rule
Services have dependencies. `web` might need `api`.
*   **Old Way**: "Start API, wait 10s, Start Web."
*   **DevMux Way**: `devmux ensure web`. (It handles the graph and health checks automatically).

### 4. The "Logs" Rule
If a service fails, **DO NOT** try to run it manually to see errors.
1.  `devmux ensure <name>` (It captures startup errors).
2.  `devmux attach <name>` (View full session logs).

## 🧩 Session Naming
Sessions follow the pattern: `omo-{project}-{service}`.
*   Example: `omo-waypoint-api`
*   You can use standard `tmux` commands if needed: `tmux capture-pane -t omo-waypoint-api -p`

## 🧪 Verification
After starting a service, `devmux` guarantees it is **healthy** (port is listening). You do NOT need to write a loop to check `curl localhost:port`. `devmux ensure` does not return until the service is ready.

## 📚 Setup & Configuration
If the user asks to set up DevMux or configure a new project, run:
```bash
devmux skill --setup
```
Read that guide to correctly configure `devmux.config.json` and `package.json`.
