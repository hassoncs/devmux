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

### Before Starting Any Service

**Always check if services are already running:**

```bash
devmux status
```

If a service shows as "Running", **do not restart it**. Use the existing instance.

### Starting Services

Use `devmux ensure` - it's idempotent and safe to call multiple times:

```bash
devmux ensure api
```

This will:
- If healthy → reuse existing (no restart)
- If unhealthy/stopped → start in tmux

### Session Naming Convention

Sessions follow the pattern: `omo-{project}-{service}`

Example for project "myapp":
- API: `omo-myapp-api`
- Worker: `omo-myapp-worker`

You can check tmux sessions directly:
```bash
tmux has-session -t omo-myapp-api && echo "Running"
```

### If You Need to Start Manually via tmux

Use **exactly** these session names:

```bash
# Check config for the exact session name pattern
cat devmux.config.json | grep sessionPrefix
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

---

**End of copy-paste section**
