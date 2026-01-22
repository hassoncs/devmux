# Agent Instructions Template for devmux

**Copy the section below into your project's `AGENTS.md` file.**

---

## Service Management (devmux)

This project uses `devmux` for tmux-based service management. This creates shared awareness between human developers and AI agents—both can see and reuse running services.

### Quick Reference

| Task | Command |
|------|---------|
| Check what's running | `devmux status` |
| Start service (idempotent) | `devmux ensure <service>` |
| View service logs | `devmux attach <service>` |
| Stop service | `devmux stop <service>` |
| Stop all services | `devmux stop all` |

### Error Watching (if enabled)

| Task | Command |
|------|---------|
| View captured errors | `devmux watch queue` |
| Check watcher status | `devmux watch status` |
| Start watching a service | `devmux watch start <service>` |
| Clear error queue | `devmux watch queue --clear` |

### Before Starting Any Service

**Always check if services are already running:**

```bash
devmux status
```

If a service shows as "Running", **do not restart it**. Use the existing instance.

### Starting Services

Use `devmux ensure` - it's idempotent and safe to call multiple times:

```bash
devmux ensure web
```

This will:
- If healthy → reuse existing (no restart)
- If unhealthy/stopped → start in tmux
- **Auto-start dependencies**: If `web` depends on `api`, it ensures `api` is healthy first!

### Session Naming Convention

Sessions follow the pattern: `omo-{project}-{service}`

Example for project "myapp":
- API: `omo-myapp-api`
- Worker: `omo-myapp-worker`

You can check tmux sessions directly:
```bash
tmux has-session -t omo-myapp-api && echo "Running"
```

### Handling Errors

If error watching is enabled, errors are automatically captured:

1. **Check for captured errors:**
   ```bash
   devmux watch queue
   ```

2. **Errors include context** - surrounding log lines and stack traces when available.

3. **After fixing**, clear the queue:
   ```bash
   devmux watch queue --clear
   ```

### Common Scenarios

**Scenario: Human already running dev server**
1. Run `devmux status`
2. See service is "Running"
3. Proceed with your task - the service is available

**Scenario: Need API for testing**
1. Run `devmux ensure api`
2. If already running, it reuses
3. If not running, it starts

**Scenario: Service seems stuck**
```bash
devmux stop api
devmux ensure api
```

**Scenario: Investigating an error**
1. Check the error queue: `devmux watch queue`
2. Review context and stack trace
3. Fix the issue
4. Clear resolved errors: `devmux watch queue --clear`

---

**End of copy-paste section**
