# Concept: Instance Isolation

## Definition

When multiple checkouts of the same project exist simultaneously (git worktrees, CI environments, parallel agent sessions), each instance gets a unique tmux session name and a deterministic port offset so they don't conflict.

## Why It Matters

In parallel AI agent workflows, it's common to have:
- Main branch checkout at `/code/myapp` with API on port 8787
- Feature branch worktree at `/code/myapp-auth-fix` also needing an API server

Without isolation:
- Both instances try to create `devmux-myapp-api` session → name collision
- Both try to use port 8787 → port conflict
- One instance restarts the other's server → state loss

With isolation:
- Main branch: session `devmux-myapp-api`, port 8787
- Worktree: session `devmux-myapp-auth-fix-api`, port 9549 (deterministic offset)

## How It Manifests

### Instance ID resolution (`devmux-cli/src/utils/worktree.ts`):

`resolveInstanceId()` (line 31) tries three sources in order:
1. `DEVMUX_INSTANCE_ID` environment variable (explicit override)
2. Git worktree detection via `git rev-parse --git-dir` — if the output matches `.git/worktrees/<name>`, extracts the worktree name
3. Falls back to empty string `""` (no instance isolation)

The worktree name is sanitized via `sanitizeInstanceId()` (line 22): lowercase, replaces non-alphanumeric with hyphens, collapses multiple hyphens, truncates to 30 chars.

### Session name construction (`devmux-cli/src/config/loader.ts`, `getSessionName()`, line 168):

```
No instanceId:    devmux-{project}-{service}
With instanceId:  devmux-{project}-{instanceId}-{service}
```

Example:
- Main: `devmux-myapp-api`
- Worktree `auth-fix`: `devmux-myapp-auth-fix-api`

### Port offset calculation (`devmux-cli/src/utils/port.ts`):

Uses djb2 hash algorithm (line 1-17):

```typescript
function calculatePortOffset(instanceId: string): number {
  let hash = 0;
  for (let i = 0; i < instanceId.length; i++) {
    hash = (hash << 5) - hash + instanceId.charCodeAt(i);
    hash = hash & hash;  // 32-bit integer overflow
  }
  return (Math.abs(hash) % 999) + 1;  // Range: 1-999
}
```

The offset is always 1-999, guaranteeing:
- Same instanceId → same offset (deterministic)
- Different instanceId → likely different offset (djb2 spreads well)
- No instance → no offset (default port unchanged)
- Offset is never 0, so instance ports always differ from the default

The final port is: `basePort + offset`. Example: port 8787 with offset 762 = 9549.

### Port resolution in config loader (`devmux-cli/src/config/loader.ts`, `getResolvedPort()`, line 224):

Extracts the base port from health config, applies offset via `resolvePort()`. This happens before health checking and service starting, so all subsequent operations use the instance-specific port.

### Environment variable injection

When a service starts, devmux injects:
- `PORT` — the resolved (offset) port
- `DEVMUX_PORT` — same value, explicit devmux namespace
- `DEVMUX_INSTANCE_ID` — the instance identifier
- `DEVMUX_SERVICE` — the service name
- `DEVMUX_PROJECT` — the project name

Services that read `$PORT` automatically use the correct instance port without config changes.

### Dependency port references

For services with `dependsOn`, proxied dependency ports are injected as `DEVMUX_PORT_{UPPERCASE_DEPENDENCY_NAME}` env vars (`devmux-cli/src/core/service.ts`, lines 406-413). This allows dependent services to reference the correct instance offset for their dependencies.

### Template substitution

The `{{INSTANCE}}` template placeholder is substituted in both command strings and env vars, allowing services that need the instance ID in their command (e.g., for build output directories) to access it.

## Practical Implications

- **Zero config for worktrees**: Git worktrees automatically get isolation — no config changes needed
- **Explicit override for non-worktree scenarios**: `DEVMUX_INSTANCE_ID=agent-1 devmux ensure api` gives explicit control for CI or other multi-checkout setups
- **Deterministic offsets**: The same worktree name always produces the same port offset, so agents can predict which port to use
- **No guarantee against all conflicts**: With 999 possible offsets, two instance IDs could theoretically hash to the same offset. With djb2's distribution, this is extremely unlikely in practice.
- **Max 30 chars for instance ID**: Very long worktree names are truncated. This could theoretically cause collisions if two worktrees share the same 30-char prefix after sanitization.
- **Services without PORT reading**: If a service hardcodes its port (e.g., `--port 8787` in the command), it ignores the `$PORT` env var and won't use the offset. Use `{{PORT}}` template in the command for such services.

## Source Attribution

- `devmux-cli/src/utils/worktree.ts` — detectWorktreeName (line 3), sanitizeInstanceId (line 22), resolveInstanceId (line 31)
- `devmux-cli/src/utils/port.ts` — calculatePortOffset (line 1), resolvePort (line 15)
- `devmux-cli/src/config/loader.ts` — getSessionName (line 168: instance-aware naming), getResolvedPort (line 224: instance-aware port resolution)
- `devmux-cli/src/core/service.ts` — buildServiceEnv (line 384: instance env vars), command template substitution (lines 112-116)
