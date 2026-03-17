# RFC-001: Zero-Config and No-Config UX for devmux

**Status:** Draft  
**Author:** Sisyphus  
**Date:** 2026-03-15  
**Related:** Internal user friction during Pencil Storybook setup

---

## Problem

When a user (human or agent) encounters devmux without a config file, the experience is broken:

1. `devmux start <service> -- <cmd>` → **Hard error**: "No devmux config found" with no recovery path
2. `devmux init` → Help output is empty, behavior unclear (interactive? writes file? prints to stdout?)
3. Agents waste 5+ minutes trying alternatives (tmux directly, nohup, etc.) when devmux could have just worked

**Real scenario:** Agent needed to start Storybook (`pnpm --filter @pencil/storybook storybook`). devmux failed immediately. No guidance on how to proceed without creating a config first. Agent fell back to raw tmux.

---

## Goals

1. **`devmux run` works without config** for ad-hoc commands
2. **`devmux init` has clear UX** — agent/user knows exactly what will happen
3. **Errors include recovery paths** — not just "config missing" but "here's how to fix it"

---

## Proposed Changes

### 1. `devmux run` without config (P0)

Currently `devmux run` requires a config. Change it to work ad-hoc:

```bash
# Without config — just wraps the command in tmux with logging
devmux run -- pnpm --filter @pencil/storybook storybook

# With session name
devmux run --session my-task -- pnpm test

# With port tracking (for later health checks)
devmux run --port 6008 -- pnpm --filter @pencil/storybook storybook
```

**Behavior without config:**
- Creates a tmux session with a generated name (e.g., `devmux-adhoc-<timestamp>`)
- Logs output to `/tmp/devmux-<session>.log`
- Tracks the PID for cleanup
- `devmux status` shows ad-hoc sessions in a separate section
- `devmux stop <session>` works on ad-hoc sessions

**Implementation:**
- Skip config loading entirely if no config found
- Use `lib/run.ts` with a minimal service descriptor
- No health check (we don't know the port unless `--port` is specified)

### 2. Improve `devmux init` help (P0)

Current `--help` output:
```
USAGE devmux init
```

Proposed:
```
USAGE devmux init [options]

Initialize devmux config for your project.

By default, prints a starter config to stdout (pipe to file):
  devmux init > devmux.config.json

Options:
  --discover     Auto-detect services from turbo.json
  --interactive  Walk through service setup (prompts for each service)
  --force        Overwrite existing config file

Examples:
  devmux init > devmux.config.json              # Basic template
  devmux init --discover > devmux.config.json   # Auto-discover from turbo.json
  devmux init --interactive                     # Step-by-step setup
```

**Also:** Make `devmux init` non-interactive by default (print to stdout, don't prompt).

### 3. Better error messages with recovery paths (P1)

Current error:
```
ERROR  No devmux config found. Create devmux.config.json or add 'devmux' to package.json
```

Proposed:
```
ERROR  No devmux config found.

To fix this, either:

  1. Run without config (ad-hoc mode):
     devmux run -- your-command-here

  2. Create a config file:
     devmux init > devmux.config.json

  3. Auto-discover from turbo.json:
     devmux init --discover > devmux.config.json

  4. Just use tmux directly:
     tmux new-session -s my-service 'your-command'
```

**Implementation:**
- Add a `formatNoConfigError()` function that includes recovery options
- Use this consistently across all commands that require config

### 4. `devmux diagnose` improvements (P1)

Add a quick "health check" for the devmux setup itself:

```bash
devmux diagnose --quick
# ✅ tmux available
# ✅ port 6008 free (or: ⚠️ port 6008 in use by node PID 12345)
# ⚠️ no devmux.config.json found (run: devmux init)
```

---

## What This Does NOT Change

- Config file format stays the same
- `ensure`, `status`, `stop` still require config (they need service definitions)
- Session naming convention unchanged
- Multi-worktree support unchanged

---

## Testing

1. **No-config scenario:** Run `devmux run -- echo "hello"` in a directory with no config → should work
2. **`devmux init --help`:** Should show the new help text
3. **Error paths:** Any command requiring config should show recovery options
4. **Backwards compat:** Existing configs should work exactly as before

---

## Rollout

1. Implement `devmux run` ad-hoc mode
2. Update help text for `init`
3. Update error messages across commands
4. Add `diagnose --quick`
5. Update docs/README with ad-hoc examples

---

## Open Questions

1. Should `devmux status` show ad-hoc sessions alongside configured services?
2. Should ad-hoc sessions get auto-cleaned after 24h (like Docker containers)?
3. Should we add `--name` flag to `devmux run` for human-readable names?
