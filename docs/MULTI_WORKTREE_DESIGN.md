# DevMux Multi-Worktree Support: Design Document

**Status**: Proposed  
**Author**: Claude (with Chris)  
**Date**: 2026-01-16

## Problem Statement

When running multiple git worktrees of the same monorepo (common in agentic coding scenarios), DevMux instances conflict because:

1. **Port conflicts**: All worktrees try to use the same hardcoded ports (e.g., API on 8787)
2. **Session conflicts**: All worktrees try to create the same tmux session names (e.g., `omo-myapp-api`)

**Goal**: Enable multiple DevMux instances to coexist without conflicts, with zero configuration for the common case.

---

## Design Principles

1. **Backwards Compatible**: If `DEVMUX_INSTANCE_ID` is not set, behavior is identical to today
2. **DevMux as Port Authority**: DevMux defines ports, services receive them via environment variables
3. **Single Source of Truth**: Ports defined once in DevMux config, not scattered across service configs
4. **Zero Config for Worktrees**: Auto-detect git worktrees when possible
5. **Deterministic**: Same instance ID always produces same ports (no random allocation)

---

## Architecture

### Current Flow (Today)

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  devmux.config  │     │     DevMux      │     │    Service      │
│                 │     │                 │     │                 │
│  api:           │────▶│  Start tmux     │────▶│  Starts on      │
│    port: 8787   │     │  session        │     │  hardcoded port │
│    cmd: pnpm dev│     │                 │     │  (from its own  │
│                 │     │  Health check   │     │   config)       │
│                 │     │  port 8787      │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘

Problem: Service might use different port than DevMux expects!
         Both worktrees fight for same port.
```

### New Flow (Proposed)

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  devmux.config  │     │     DevMux      │     │    Service      │
│                 │     │                 │     │                 │
│  api:           │────▶│  1. Detect      │────▶│  Reads PORT     │
│    port: 8787   │     │     instance ID │     │  from env var   │
│    cmd: pnpm dev│     │                 │     │                 │
│                 │     │  2. Calculate   │     │  Starts on      │
│                 │     │     resolved    │     │  $PORT (9210)   │
│                 │     │     port: 9210  │     │                 │
│                 │     │                 │     │                 │
│                 │     │  3. Start tmux  │     │                 │
│                 │     │     with PORT   │     │                 │
│                 │     │     env var     │     │                 │
│                 │     │                 │     │                 │
│                 │     │  4. Health check│     │                 │
│                 │     │     port 9210   │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘

DevMux is the single source of truth for ports.
Services just read from environment variables.
```

---

## Detailed Design

### 1. Instance ID Detection

**Priority Order:**
1. `DEVMUX_INSTANCE_ID` environment variable (explicit override)
2. Auto-detected git worktree name (if in a worktree)
3. Empty string (default - preserves current behavior)

**Git Worktree Detection:**
```typescript
function detectWorktreeName(): string | null {
  try {
    const gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf-8' }).trim();
    
    // In a worktree, .git is a file containing "gitdir: /path/to/.git/worktrees/<name>"
    // The git-dir will be like: /path/to/main/.git/worktrees/feature-x
    if (gitDir.includes('.git/worktrees/')) {
      const match = gitDir.match(/\.git\/worktrees\/([^/]+)/);
      return match ? match[1] : null;
    }
    
    return null; // Not in a worktree
  } catch {
    return null;
  }
}
```

**Instance ID Resolution:**
```typescript
function resolveInstanceId(): string {
  // 1. Explicit override
  if (process.env.DEVMUX_INSTANCE_ID) {
    return sanitize(process.env.DEVMUX_INSTANCE_ID);
  }
  
  // 2. Auto-detect worktree
  const worktreeName = detectWorktreeName();
  if (worktreeName) {
    return sanitize(worktreeName);
  }
  
  // 3. Default: empty (backwards compatible)
  return '';
}

function sanitize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
}
```

### 2. Session Naming

**Current Pattern:** `{prefix}-{service}`  
**New Pattern:** `{prefix}-{instance}-{service}` (when instance ID is set)

```typescript
function getSessionName(config: ResolvedConfig, serviceName: string): string {
  const service = config.services[serviceName];
  if (service?.sessionName) {
    return service.sessionName; // Explicit override always wins
  }
  
  if (config.instanceId) {
    return `${config.resolvedSessionPrefix}-${config.instanceId}-${serviceName}`;
  }
  
  return `${config.resolvedSessionPrefix}-${serviceName}`;
}
```

**Examples:**
| Instance ID | Service | Session Name |
|-------------|---------|--------------|
| (empty) | api | `omo-myapp-api` |
| `feature-x` | api | `omo-myapp-feature-x-api` |
| `agent-1` | worker | `omo-myapp-agent-1-worker` |

### 3. Port Resolution

**Backwards Compatibility Rule:**
- No instance ID → port unchanged (8787 stays 8787)
- With instance ID → port offset applied

**Offset Calculation:**
```typescript
function calculatePortOffset(instanceId: string): number {
  if (!instanceId) return 0;
  
  // Simple hash function - deterministic, spreads well
  let hash = 0;
  for (let i = 0; i < instanceId.length; i++) {
    hash = ((hash << 5) - hash) + instanceId.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  // Map to range 1-999 (never 0, to ensure different from default)
  return (Math.abs(hash) % 999) + 1;
}

function resolvePort(basePort: number, instanceId: string): number {
  return basePort + calculatePortOffset(instanceId);
}
```

**Examples:**
| Instance ID | Base Port | Offset | Resolved Port |
|-------------|-----------|--------|---------------|
| (empty) | 8787 | 0 | 8787 |
| `feature-x` | 8787 | 423 | 9210 |
| `agent-1` | 8787 | 156 | 8943 |
| `feature-x` | 3000 | 423 | 3423 |

### 4. Environment Variable Injection

**Core Concept:** DevMux passes the resolved port to services via environment variables.

**Standard Variables (Always Set):**
```bash
PORT=9210                    # Primary service port
DEVMUX_PORT=9210            # Explicit DevMux-provided port
DEVMUX_INSTANCE_ID=feature-x # Current instance (if any)
DEVMUX_SERVICE=api          # Service name
```

**Service-Specific Variables (Optional - from config):**
```json
{
  "services": {
    "api": {
      "port": 8787,
      "env": {
        "API_PORT": "{{PORT}}",
        "DATABASE_URL": "postgres://localhost:5432/myapp_{{INSTANCE}}"
      }
    }
  }
}
```

**Template Variables Available:**
| Variable | Description | Example |
|----------|-------------|---------|
| `{{PORT}}` | Resolved port for this service | `9210` |
| `{{BASE_PORT}}` | Original port from config | `8787` |
| `{{INSTANCE}}` | Instance ID (or empty) | `feature-x` |
| `{{SERVICE}}` | Service name | `api` |
| `{{PROJECT}}` | Project name | `myapp` |

### 5. Config Schema Changes

**Current Schema:**
```typescript
interface ServiceDefinition {
  cwd: string;
  command: string;
  health: HealthCheckType;
  sessionName?: string;
  env?: Record<string, string>;
  stopPorts?: number[];
  dependsOn?: string[];
}
```

**New Schema (Backwards Compatible):**
```typescript
interface ServiceDefinition {
  cwd: string;
  command: string;
  health: HealthCheckType;
  sessionName?: string;
  env?: Record<string, string>;  // Now supports {{PORT}}, {{INSTANCE}}, etc.
  stopPorts?: number[];
  dependsOn?: string[];
  
  // NEW: Explicit port definition (alternative to health.port)
  port?: number;
}

interface DevMuxConfig {
  version: 1;
  project: string;
  sessionPrefix?: string;
  defaults?: {
    startupTimeoutSeconds?: number;
    remainOnExit?: boolean;
  };
  services: Record<string, ServiceDefinition>;
  
  // NEW: Instance configuration
  instance?: {
    // Override auto-detection (rarely needed)
    id?: string;
    // Port offset range (default: 1-999)
    portOffsetRange?: number;
  };
}
```

**Port Source Priority:**
1. `service.port` (explicit, new field)
2. `service.health.port` (from port health check)
3. Port extracted from `service.health.url` (from HTTP health check)

---

## Example Configurations

### Example 1: Minimal Config (Works Today, Enhanced Tomorrow)

```json
{
  "version": 1,
  "project": "myapp",
  "services": {
    "api": {
      "cwd": "packages/api",
      "command": "pnpm dev",
      "health": { "type": "port", "port": 8787 }
    }
  }
}
```

**Behavior:**
- Without `DEVMUX_INSTANCE_ID`: Port 8787, session `omo-myapp-api`
- With `DEVMUX_INSTANCE_ID=feature-x`: Port 9210, session `omo-myapp-feature-x-api`
- Service receives `PORT=8787` (or `PORT=9210`) in environment

### Example 2: Multi-Port Service

```json
{
  "version": 1,
  "project": "myapp",
  "services": {
    "api": {
      "cwd": "packages/api",
      "command": "pnpm dev",
      "port": 8787,
      "health": { "type": "port", "port": 8787 },
      "env": {
        "PORT": "{{PORT}}",
        "METRICS_PORT": "{{PORT + 1}}"
      },
      "stopPorts": [8787, 8788]
    }
  }
}
```

### Example 3: Database URL with Instance Isolation

```json
{
  "version": 1,
  "project": "myapp",
  "services": {
    "api": {
      "cwd": "packages/api",
      "command": "pnpm dev",
      "port": 8787,
      "health": { "type": "port", "port": 8787 },
      "env": {
        "DATABASE_URL": "postgres://localhost:5432/myapp{{INSTANCE ? '_' + INSTANCE : ''}}"
      }
    }
  }
}
```

**Result:**
- No instance: `DATABASE_URL=postgres://localhost:5432/myapp`
- Instance `feature-x`: `DATABASE_URL=postgres://localhost:5432/myapp_feature-x`

---

## Migration Path

### Phase 1: Core Implementation (This PR)
- Instance ID detection (env var + worktree auto-detect)
- Session naming with instance ID
- Port offset calculation
- Basic env var injection (`PORT`, `DEVMUX_*`)
- Backwards compatible: no instance = no changes

### Phase 2: Enhanced Templates (Future)
- `{{PORT + N}}` arithmetic
- `{{INSTANCE ? x : y}}` conditionals
- Per-service port field

### Phase 3: Advanced Features (Future)
- `devmux status --all-instances` to show all running instances
- `devmux stop --instance=feature-x` to target specific instance
- Instance discovery across worktrees

---

## Testing Plan

### Unit Tests
- [ ] `sanitize()` handles special characters
- [ ] `detectWorktreeName()` correctly identifies worktrees
- [ ] `resolveInstanceId()` priority order
- [ ] `calculatePortOffset()` is deterministic
- [ ] `getSessionName()` with/without instance
- [ ] `resolvePort()` with/without instance

### Integration Tests
- [ ] Start service without instance ID (backwards compat)
- [ ] Start service with `DEVMUX_INSTANCE_ID`
- [ ] Two instances don't conflict (different ports, sessions)
- [ ] `PORT` env var passed to service
- [ ] Health check uses resolved port
- [ ] Stop service cleans up correctly

### Manual Tests
- [ ] Real git worktree auto-detection
- [ ] Run two worktrees simultaneously
- [ ] `devmux status` shows correct info

---

## FAQ

**Q: What if two instance IDs hash to the same offset?**
A: With a 999-value range, collision probability is ~0.1% for 2 instances. For safety, we could add collision detection that warns or auto-increments.

**Q: What if a service doesn't respect the PORT env var?**
A: The service must be configured to read from `PORT`. This is a common pattern (Heroku, Railway, etc.). We document this requirement.

**Q: Does this work with services that use multiple ports?**
A: Yes, use the `env` field with `{{PORT}}` and `{{PORT + 1}}`, etc. Or configure each port explicitly.

**Q: Can I use this without git worktrees?**
A: Yes, set `DEVMUX_INSTANCE_ID` explicitly. Useful for CI, multiple checkouts, etc.

**Q: Will this break existing configs?**
A: No. Without `DEVMUX_INSTANCE_ID` set, behavior is identical to today.

---

## Decision Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Instance ID source | Env var + auto-detect worktree | Zero config for worktrees, explicit control available |
| Port offset method | Hash-based, deterministic | Predictable, same ID = same port across restarts |
| Offset range | 1-999 | Large enough to avoid collision, small enough to stay in valid port range |
| Session naming | `prefix-instance-service` | Clear, sortable, backwards compatible |
| Env var name | `PORT` | Industry standard (Heroku, Railway, etc.) |

---

## Implementation Checklist

- [ ] Add `instanceId` to `ResolvedConfig`
- [ ] Implement `detectWorktreeName()` in new file `utils/worktree.ts`
- [ ] Implement `resolveInstanceId()` in `config/loader.ts`
- [ ] Implement `calculatePortOffset()` in new file `utils/port.ts`
- [ ] Update `getSessionName()` to include instance ID
- [ ] Add `getResolvedPort()` function
- [ ] Update `ensureService()` to pass PORT env var
- [ ] Update health checks to use resolved port
- [ ] Add `--instance` CLI flag (optional)
- [ ] Update `status` command to show instance info
- [ ] Add tests
- [ ] Update README
