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

### Browser/App Telemetry (if enabled)

When working with web or mobile apps, browser console logs and errors stream to tmux via the telemetry system.

| Task | Command |
|------|---------|
| Start telemetry server | `devmux telemetry start` |
| Check telemetry status | `devmux telemetry status` |
| Stop telemetry server | `devmux telemetry stop` |

**How it works:**
- Browser/app errors appear in the error queue (`devmux watch queue`)
- Console logs stream to tmux sessions named `devmux-telemetry-{stream}`
- Stack traces are automatically captured for errors

**Scenario: Browser error during development**
1. Check the error queue: `devmux watch queue`
2. Browser errors will have source like `telemetry:browser:localhost-3000`
3. Full stack traces and context are captured
4. You can also attach to the telemetry tmux session to see live logs

**Scenario: Setting up telemetry for a new app**
1. Ensure telemetry server is running: `devmux telemetry start`
2. Add the client SDK to the app (see README for setup instructions)
3. Initialize with `initTelemetry({ appName: 'my-app' })` in dev mode
4. Logs and errors will now stream to DevMux

---

**End of copy-paste section**
