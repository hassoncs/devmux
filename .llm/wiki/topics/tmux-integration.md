# Topic: tmux Integration

## Purpose

How devmux creates, manages, and interacts with tmux sessions. tmux serves as the persistent process container and log viewer for all managed services.

## Normative Rules

- Sessions MUST use predictable names following the `{prefix}-{project}[-{instance}]-{service}` pattern
- Sessions MUST be created in detached mode (`-d`)
- Environment variables MUST be injected via `send-keys` (not `-e`) to survive direnv reloads
- The `remain-on-exit` option MUST be configurable per config defaults
- Session names MUST be sanitized — `:` and `.` are replaced with `-` (tmux treats them as delimiters)

## How It Works

### Core tmux operations

All tmux interaction is in `devmux-cli/src/tmux/driver.ts` (74 lines total).

**hasSession** (line 3): Runs `tmux has-session -t {name}`. Returns `true` if exit code is 0, `false` otherwise. Catches errors silently.

**listSessions** (line 14): Runs `tmux list-sessions -F #{session_name}`, splits by newline, optionally filters by prefix. Returns empty array on error.

**newSession** (line 30): Two-phase operation:
1. `spawnSync("tmux", ["new-session", "-d", "-s", sessionName, "-c", cwd])` — creates detached session with working directory
2. `spawnSync("tmux", ["send-keys", "-t", sessionName, "{envPrefix}{command}", "Enter"])` — sends the command

**Why send-keys instead of `-e`**: tmux's `new-session -e` only sets vars on the initial shell. By using `send-keys` with prefixed env vars (`PORT=8787 DEVMUX_SERVICE=api pnpm dev`), the variables are set on the actual command process, surviving any direnv reload that might happen in the intermediate shell (lines 42-49).

**setRemainOnExit** (line 52): Runs `tmux set-option -t "{session}" remain-on-exit on|off`. Controls whether the session persists after the process exits (useful for viewing crash output).

**killSession** (line 61): Runs `tmux kill-session -t "{name}"`. Silently catches errors (e.g., session already dead).

**attachSession** (line 69): Uses `spawn` (not `spawnSync` or `execSync`) because `tmux attach` takes over the terminal. Child process inherits stdio (`stdio: "inherit"`), so user can interact with the tmux session directly.

### Session name construction

Session names are built in `devmux-cli/src/config/loader.ts`, `getSessionName()` (line 168):

1. If `service.sessionName` is explicitly set, use it (sanitized)
2. If `config.instanceId` exists: `{prefix}-{instanceId}-{serviceName}`
3. Otherwise: `{prefix}-{serviceName}`

The prefix defaults to `devmux-{project}` (configured in `resolveLoadedConfig`, line 69).

Sanitization replaces `:` and `.` with `-` to avoid tmux's `session:window.pane` delimiter parsing (`sanitizeTmuxSessionName`, line 191).

### Integration with service lifecycle

- `ensureService` calls `tmux.newSession()` to create a new session, then `tmux.setRemainOnExit()` to configure persistence
- `stopService` calls `tmux.killSession()` to destroy the session
- `getStatus` calls `tmux.hasSession()` to check session existence
- `attachService` calls `tmux.attachSession()` for interactive log viewing

## Key Files

| File | Role |
|---|---|
| `devmux-cli/src/tmux/driver.ts` | All tmux CLI operations (74 lines) |
| `devmux-cli/src/config/loader.ts` | Session name construction, sanitization |

## Edge Cases

- **tmux not installed**: `execSync` will throw — the error bubbles up as a runtime error. No explicit "tmux not found" handling exists in driver.ts
- **Session name with special chars**: Colon and period are replaced with hyphens at the builder level
- **Attach in non-interactive context**: `attachSession` uses `spawn` with inherited stdio, so it will hang in non-interactive environments (CI, scripts)
- **Direnv interaction**: The env-var-via-send-keys approach specifically addresses direnv overwriting `-e` vars — this is a deliberate design choice documented in the code comments

## Source Attribution

- `devmux-cli/src/tmux/driver.ts` — hasSession (line 3), listSessions (line 14), newSession (line 30), setRemainOnExit (line 52), killSession (line 61), attachSession (line 69)
- `devmux-cli/src/config/loader.ts` — getSessionName (line 168), sanitizeTmuxSessionName (line 191)
