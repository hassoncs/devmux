# Skill vs AGENTS.md: Which Approach for devmux?

## TL;DR

**Use AGENTS.md, not a Claude skill.** Here's why:

## What's a Claude Skill?

A Claude skill is a specialized prompt that gets injected when certain triggers are detected. Skills are good for:
- Complex multi-step workflows (e.g., Playwright browser automation)
- Domain-specific knowledge that requires detailed instructions
- Workflows that need to override default behavior

## Why AGENTS.md is Sufficient for devmux

devmux is a **simple CLI tool** with:
1. **Self-documenting commands**: `devmux --help`, `devmux status`
2. **Predictable behavior**: `ensure` is always idempotent
3. **No complex workflows**: Just check status, start, stop

The agent doesn't need special instructions beyond:
- "Check if running before starting"
- "Use `devmux ensure` (it's idempotent)"
- "Session names follow `omo-{project}-{service}` pattern"

This fits naturally in AGENTS.md—a few lines of documentation.

## When Would a Skill Make Sense?

A skill would be overkill for devmux, but might make sense if:
- There were complex conditional workflows
- Service dependencies required orchestration
- There were many edge cases to handle
- The tool required multi-step wizards

## The AGENTS.md Approach

Add to your project's AGENTS.md:

```markdown
## Service Management (devmux)

| Task | Command |
|------|---------|
| Check status | `devmux status` |
| Start service | `devmux ensure <service>` |
| View logs | `devmux attach <service>` |
| Stop | `devmux stop <service>` |

**Always check `devmux status` before starting services.**
```

That's it. The agent will:
1. See this in the project context
2. Know to check status first
3. Know the right commands to use

## Benefits of AGENTS.md Over Skills

| Aspect | AGENTS.md | Skill |
|--------|-----------|-------|
| Simplicity | Just markdown in your repo | Requires skill installation |
| Visibility | Anyone can read/edit | Hidden in skill config |
| Portability | Works with any AI tool | Claude-specific |
| Maintenance | Update in one place | Update skill separately |
| Scope | Project-specific | Global or per-user |

## Conclusion

devmux is designed to be simple enough that AGENTS.md documentation is sufficient. The tool follows conventions (idempotent ensure, predictable session names) that make it naturally agent-friendly without special skills.

If you're using OpenCode, the `interactive_bash` already understands tmux. devmux just adds a layer of convenience and the shared naming convention.
