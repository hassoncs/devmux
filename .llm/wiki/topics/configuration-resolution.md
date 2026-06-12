# Topic: Configuration & Resolution

## Purpose

How devmux discovers config files, resolves them into a `ResolvedConfig`, handles multi-worktree isolation, and generates session names and ports.

## Normative Rules

- Config discovery MUST search upward from `process.cwd()` through parent directories
- Config files MUST be searched in order: `devmux.config.json`, `.devmuxrc.json`, `.devmuxrc`, then `package.json#devmux`
- The `version` field MUST be `1` — any other value is invalid
- The `project` field MUST be a non-empty string
- The `services` object MUST exist and contain at least one service
- Proxy hostname patterns MUST resolve to `.localhost` when there are 3+ dot-separated segments
- Session names MUST be sanitized (no `:` or `.`)
- Instance IDs MUST be sanitized: lowercase, alphanumeric + hyphens only, max 30 chars
- Port offsets MUST be deterministic — same instance ID always produces the same offset

## How It Works

### Config discovery

`findConfigFile()` in `devmux-cli/src/config/loader.ts` (line 16):

Walks upward from `startDir` to filesystem root. At each directory level, checks for config files in order:
1. `devmux.config.json`
2. `.devmuxrc.json`
3. `.devmuxrc`
4. `package.json` — if present, parses it and checks for a `devmux` key

Returns the first match found. Returns `null` if nothing found.

### Config loading

`loadConfigFromFile()` (line 41) reads the file. If it's `package.json`, extracts the `devmux` key. Otherwise parses as raw JSON.

### Config resolution

`resolveLoadedConfig()` (line 56) transforms a `DevMuxConfig` into a `ResolvedConfig`:
1. Validates the config structure
2. Validates proxy hostname pattern (`.localhost` enforcement)
3. Sets `configRoot` to the directory containing the config file
4. Sets `resolvedSessionPrefix` to `config.sessionPrefix` or `devmux-{project}`
5. Resolves `instanceId` via `resolveInstanceId()` (see Instance Isolation below)

### Two load modes

- `loadConfig()` (line 134): upward-searching mode, uses `process.cwd()` by default. Auto-detects worktree instance ID.
- `loadConfigExact()` (line 147): exact-path mode, only checks the specified `projectRoot` directory. Supports explicit `instanceId` override.

### Session name construction

`getSessionName()` in `devmux-cli/src/config/loader.ts` (line 168):

```
Priority 1: service.sessionName (explicit override)
Priority 2: {prefix}-{instanceId}-{serviceName} (if instanceId exists)
Priority 3: {prefix}-{serviceName} (default)
```

Sanitization replaces `:` and `.` with `-`.

### Port resolution

`getResolvedPort()` in `devmux-cli/src/config/loader.ts` (line 224):

Extracts the base port from `service.health` (port type) or `service.port`, then applies the instance-based offset via `resolvePort()`.

`getBasePort()` (line 206): Extracts port from health config:
- Port type: returns `health.port`
- HTTP type: parses URL, returns port or inferred 80/443

### Validation

`validateConfig()` (line 77): Checks `version === 1`, `project` is string, `services` is object.

`validateProxyHostnamePattern()` (line 88): Ensures hostname patterns end in `.localhost` when they have 3+ DNS segments. Strips `http://`/`https://` prefix before checking.

```typescript
interface DevMuxConfig {
  version: 1;
  project: string;
  sessionPrefix?: string;
  defaults?: {
    startupTimeoutSeconds?: number;
    remainOnExit?: boolean;
    dashboard?: boolean | { port?: number };
  };
  proxy?: ProxyConfig;
  watch?: GlobalWatchConfig;
  services: Record<string, ServiceDefinition>;
}
```

Interface from `devmux-cli/src/config/types.ts`.

## Key Files

| File | Role |
|---|---|
| `devmux-cli/src/config/loader.ts` | Config discovery, loading, resolution, session names, ports (235 lines) |
| `devmux-cli/src/config/types.ts` | All TypeScript interfaces (91 lines) |
| `devmux-cli/src/utils/worktree.ts` | Worktree detection, instance ID resolution |
| `devmux-cli/src/utils/port.ts` | Port offset calculation |

## Edge Cases

- **Config in parent directory**: Walking upward means a monorepo can have one config at the root, and sub-projects inherit it. The `configRoot` is set to where the config was found, not `process.cwd()`.
- **package.json with devmux key**: If `package.json` has no `devmux` key, discovery continues to parent directories. This allows nested packages to use the root config.
- **Empty instance ID**: When outside a worktree and no `DEVMUX_INSTANCE_ID` env var, `resolveInstanceId()` returns `""`. This causes session names to omit the instance component.
- **Worktree detection**: Uses `git rev-parse --git-dir` output format `/.git/worktrees/<name>`. If the git-dir doesn't match this pattern, returns `null`.
- **Instance ID sanitization**: Capped at 30 chars, replaces non-alphanumeric chars with hyphens, collapses multiple hyphens. Prevents overly long tmux session names.

## Source Attribution

- `devmux-cli/src/config/loader.ts` — findConfigFile (line 16), loadConfigFromFile (line 41), resolveLoadedConfig (line 56), validateConfig (line 77), validateProxyHostnamePattern (line 88), loadConfig (line 134), loadConfigExact (line 147), getSessionName (line 168), sanitizeTmuxSessionName (line 191), getServiceCwd (line 195), getBasePort (line 206), getResolvedPort (line 224)
- `devmux-cli/src/config/types.ts` — All interface definitions
- `devmux-cli/src/utils/worktree.ts` — detectWorktreeName (line 3), sanitizeInstanceId (line 22), resolveInstanceId (line 31)
- `devmux-cli/src/utils/port.ts` — calculatePortOffset (line 1), resolvePort (line 15)
