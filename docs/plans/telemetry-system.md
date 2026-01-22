# DevMux Telemetry System

## Implementation Plan & Technical Design

**Status:** Planning  
**Version:** 1.1  
**Date:** January 2026

---

## Executive Summary

DevMux Telemetry is a **framework-agnostic, local-first telemetry pipeline** that streams browser/app console logs and runtime errors into DevMux, where they appear as tmux-style log sessions and are written to the existing error queue.

The system follows the same architectural pattern as Sentry and LogRocket:
- **Many possible client SDKs** (JavaScript/React Native MVP, future: Node, CLI, extensions)
- **One common ingestion server** (WebSocket-based)
- **OpenTelemetry-aligned protocol** (industry standard log format)
- **Local-first, streaming** (not batching)

**Primary Target:** Expo apps (React Native + Web) via a single SDK that works in both environments.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐       │
│  │   JS Client      │  │   Node Client    │  │  Chrome Ext.     │       │
│  │  (MVP - v1.0)    │  │   (future)       │  │  (future)        │       │
│  │                  │  │                  │  │                  │       │
│  │  • Browser       │  │  • stdout/stderr │  │  • devtools      │       │
│  │  • React Native  │  │  • process errors│  │  • network       │       │
│  │  • Expo (Web+RN) │  │  • uncaught      │  │  • console       │       │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘       │
│           │                     │                     │                  │
│           └─────────────────────┼─────────────────────┘                  │
│                                 │                                        │
│                    WebSocket (ws://127.0.0.1:8787)                       │
│                                 │                                        │
└─────────────────────────────────┼────────────────────────────────────────┘
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         TELEMETRY SERVER                                 │
│                    @chriscode/devmux-telemetry-server                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                  │
│  │  WebSocket  │───▶│  Protocol   │───▶│   Session   │                  │
│  │  Ingestion  │    │  Validator  │    │   Manager   │                  │
│  └─────────────┘    └─────────────┘    └──────┬──────┘                  │
│                                               │                          │
│                                               ▼                          │
│                                      ┌─────────────┐                     │
│                                      │   Router    │                     │
│                                      └──────┬──────┘                     │
│                                             │                            │
│                            ┌────────────────┼────────────────┐           │
│                            ▼                ▼                ▼           │
│                    ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│                    │    tmux     │  │  queue.jsonl│  │   stdout    │    │
│                    │   panes     │  │  (existing) │  │  (debug)    │    │
│                    └─────────────┘  └─────────────┘  └─────────────┘    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         DEVMUX INTEGRATION                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  tmux sessions:        browser:localhost-3000                            │
│                        browser:localhost-5173                            │
│                        browser:admin-ui                                  │
│                                                                          │
│  queue.jsonl:          ~/.opencode/triggers/queue.jsonl                  │
│                        (same format as existing TriggerEvent)            │
│                                                                          │
│  CLI commands:         devmux telemetry start                            │
│                        devmux telemetry stop                             │
│                        devmux telemetry status                           │
│                        devmux attach browser:localhost-3000              │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Package Organization

### New Packages

```
devmux/
├── packages/
│   ├── telemetry-server/          # @chriscode/devmux-telemetry-server
│   │   ├── package.json
│   │   ├── tsup.config.ts
│   │   └── src/
│   │       ├── index.ts           # Public API exports
│   │       ├── protocol.ts        # Protocol types + validation (OTel-aligned)
│   │       ├── server.ts          # WebSocket server
│   │       ├── session.ts         # Session lifecycle management
│   │       ├── router.ts          # Event routing (tmux, queue)
│   │       └── formatter.ts       # Pretty-print for tmux output
│   │
│   └── telemetry-client/          # @chriscode/devmux-telemetry
│       ├── package.json
│       ├── tsup.config.ts         # ESM bundles (browser + RN compatible)
│       └── src/
│           ├── index.ts           # Public API (init, shutdown)
│           ├── client.ts          # WebSocket client + reconnect
│           ├── protocol.ts        # Protocol types (OTel-aligned)
│           ├── transport.ts       # Message streaming
│           ├── platform.ts        # Platform detection (browser vs RN)
│           └── capture/
│               ├── console.ts     # console.* monkey-patching (works in RN too)
│               └── errors.ts      # Error handlers (browser + RN variants)
│
├── devmux-cli/                    # Existing - adds CLI commands
│   └── src/
│       └── telemetry/
│           ├── commands.ts        # citty command definitions
│           └── server-manager.ts  # Start/stop server process
│
└── landing/                       # Existing (unchanged)
```

### Package Names

| Package | npm Name | Purpose |
|---------|----------|---------|
| telemetry-server | `@chriscode/devmux-telemetry-server` | WebSocket server, session management |
| telemetry-client | `@chriscode/devmux-telemetry` | Universal JS SDK (Browser + React Native + Expo) |

**Why a single client package?**
- Console monkey-patching works identically in browser and React Native
- WebSocket API is the same in both environments
- Expo apps can target both web and native from one codebase
- Follows Sentry's pattern: shared core with platform-specific error handlers

### Workspace Configuration

**pnpm-workspace.yaml:**
```yaml
packages:
  - "devmux-cli"
  - "landing"
  - "packages/*"
```

---

## Protocol Specification

### Design Principles

1. **OpenTelemetry-aligned** - Uses OTel Logs Data Model severity numbers and field names
2. **Versioned from day one** - Breaking changes require version bump
3. **Forward compatible** - Unknown fields MUST be ignored
4. **Backward compatible** - Old clients should work with new servers
5. **Structured payloads** - No early stringification, preserve types

### OpenTelemetry Alignment

We align with the [OpenTelemetry Logs Data Model](https://opentelemetry.io/docs/specs/otel/logs/data-model/) for:

| OTel Field | Our Usage |
|------------|-----------|
| `Timestamp` | Unix nanoseconds (we use milliseconds for simplicity) |
| `SeverityNumber` | 1-24 scale (TRACE=1-4, DEBUG=5-8, INFO=9-12, WARN=13-16, ERROR=17-20, FATAL=21-24) |
| `SeverityText` | Original string ("log", "warn", "error", etc.) |
| `Body` | The log content (can be any structured value) |
| `Attributes` | Key-value metadata |
| `Resource` | Client info (app name, version, platform) |

This alignment means:
- Our logs can be exported to any OTel-compatible backend later
- Familiar format for developers who've used OTel
- Standard severity comparison semantics

### Message Envelope

Every message follows this envelope structure:

```typescript
interface TelemetryEnvelope<TPayload> {
  protocol: "devmux-telemetry";  // Always this exact string
  version: 1;                     // Protocol version
  type: "hello" | "goodbye" | "log";
  payload: TPayload;
  meta: {
    clientId: string;    // UUID, stable per app session
    sessionId?: string;  // Server-assigned after hello
    timestamp: number;   // Unix milliseconds
  };
}
```

### Message Types

#### 1. Hello (Client → Server)

Sent immediately after WebSocket connection. Server responds with session assignment.

```typescript
interface TelemetryHelloPayload {
  // OTel "Resource" equivalent
  resource: {
    "service.name": string;        // App identifier
    "service.version"?: string;    // App version
    "telemetry.sdk.name": string;  // "@chriscode/devmux-telemetry"
    "telemetry.sdk.version": string;
  };
  // Platform-specific info
  platform: {
    kind: "browser" | "react-native" | "expo" | "node";
    os?: string;           // "ios", "android", "web", "macos", etc.
    url?: string;          // Current URL (browser/web only)
    userAgent?: string;    // User agent string
    bundler?: string;      // "metro", "vite", "webpack", etc.
  };
}
```

**Server Response:**
```typescript
interface HelloResponse {
  sessionId: string;   // UUID assigned by server
  streamName: string;  // e.g., "expo:mingle-ios", "browser:localhost-3000"
}
```

#### 2. Goodbye (Client → Server)

Sent before intentional disconnect. Allows clean session teardown.

```typescript
interface TelemetryGoodbyePayload {
  reason?: string;  // Optional: "page-unload", "app-background", "shutdown"
}
```

#### 3. Log (Client → Server)

All telemetry data flows through log messages. Aligned with OTel LogRecord.

```typescript
interface TelemetryLogPayload {
  // OTel LogRecord fields
  timestamp: number;           // Unix milliseconds
  severityNumber: number;      // 1-24 (OTel scale)
  severityText: string;        // "log", "warn", "error", etc.
  body: unknown;               // The actual log content (any JSON-serializable value)
  attributes?: Record<string, unknown>;  // Additional metadata
  
  // Source location (if available)
  source?: {
    file?: string;
    line?: number;
    column?: number;
  };
  
  // For errors specifically
  exception?: {
    type: string;              // "TypeError", "ReferenceError", etc.
    message: string;
    stacktrace?: string;
    isUnhandled?: boolean;     // true for uncaught errors/rejections
  };
}
```

### Severity Number Mapping (OTel Standard)

| Console Method | SeverityNumber | SeverityText | OTel Range |
|----------------|----------------|--------------|------------|
| `console.trace` | 1 | "trace" | TRACE (1-4) |
| `console.debug` | 5 | "debug" | DEBUG (5-8) |
| `console.log` | 9 | "log" | INFO (9-12) |
| `console.info` | 9 | "info" | INFO (9-12) |
| `console.warn` | 13 | "warn" | WARN (13-16) |
| `console.error` | 17 | "error" | ERROR (17-20) |
| Uncaught error | 17 | "error" | ERROR (17-20) |
| Unhandled rejection | 17 | "error" | ERROR (17-20) |

### Stream Naming Convention

The server assigns stream names based on the hello payload:

| Platform | Context | Stream Name |
|----------|---------|-------------|
| browser | http://localhost:3000 | `browser:localhost-3000` |
| expo (web) | http://localhost:8081 | `expo:web-8081` |
| expo (ios) | Mingle app | `expo:mingle-ios` |
| expo (android) | Mingle app | `expo:mingle-android` |
| react-native | MyApp | `rn:myapp-ios` |
| node | CLI tool | `node:cli-name` |

---

## Integration with Existing DevMux

### Reusing Existing Infrastructure

The telemetry server reuses several existing DevMux components:

| Component | Location | Usage |
|-----------|----------|-------|
| tmux driver | `devmux-cli/src/tmux/driver.ts` | Create/attach sessions for streams |
| Queue writer | `devmux-cli/src/watch/queue.ts` | Write events to `queue.jsonl` |
| TriggerEvent | `devmux-cli/src/watch/types.ts` | Event format for queue |
| Deduper | `devmux-cli/src/watch/deduper.ts` | Content hashing, dedupe cache |

### TriggerEvent Mapping

Telemetry events are mapped to the existing `TriggerEvent` format:

```typescript
// Console event → TriggerEvent
{
  id: randomUUID(),
  timestamp: new Date().toISOString(),
  source: "telemetry:browser:localhost-3000",
  service: "browser:localhost-3000",
  project: "telemetry",
  severity: mapConsoleLevelToSeverity(payload.level),
  pattern: "telemetry-console",
  rawContent: formatConsoleArgs(payload.args),
  context: [],  // Could include recent console history
  stackTrace: undefined,
  status: "pending",
  contentHash: computeContentHash(...),
  firstSeen: new Date().toISOString(),
}

// Error event → TriggerEvent
{
  id: randomUUID(),
  timestamp: new Date().toISOString(),
  source: "telemetry:browser:localhost-3000",
  service: "browser:localhost-3000",
  project: "telemetry",
  severity: "error",
  pattern: payload.isUnhandledRejection ? "telemetry-unhandled-rejection" : "telemetry-error",
  rawContent: `${payload.name}: ${payload.message}`,
  context: [],
  stackTrace: payload.stack?.split("\n"),
  status: "pending",
  contentHash: computeContentHash(...),
  firstSeen: new Date().toISOString(),
}
```

### Severity Mapping

| Console Level | TriggerEvent Severity |
|---------------|----------------------|
| `log`, `debug`, `trace` | `info` |
| `info` | `info` |
| `warn` | `warning` |
| `error` | `error` |

---

## Client SDK Usage

### Installation

```bash
npm install @chriscode/devmux-telemetry
# or
pnpm add @chriscode/devmux-telemetry
```

### Browser Usage

```typescript
// In your app's entry point (e.g., main.tsx)
import { initTelemetry } from '@chriscode/devmux-telemetry';

// Only runs in development by default
initTelemetry({
  serverUrl: 'ws://127.0.0.1:9876',
  serviceName: 'my-web-app',
  // enabled: true,  // Force enable (default: __DEV__ or NODE_ENV !== 'production')
});

// Later, if needed:
import { shutdownTelemetry } from '@chriscode/devmux-telemetry';
shutdownTelemetry();
```

### Expo / React Native Usage

```typescript
// In your app's entry point (e.g., App.tsx or _layout.tsx)
import { initTelemetry } from '@chriscode/devmux-telemetry';

// Auto-detects platform (ios, android, web)
initTelemetry({
  serverUrl: 'ws://192.168.1.100:9876',  // Use your dev machine's IP for device testing
  serviceName: 'mingle',
  // enabled: __DEV__,  // This is the default
});
```

**Expo Considerations:**
- Use your dev machine's local IP (not `localhost`) when testing on physical devices
- Works on Expo Go, development builds, and production builds
- Auto-detects platform: `expo:mingle-ios`, `expo:mingle-android`, `expo:mingle-web`
- Same SDK works for all Expo targets (no separate package needed)

### What Gets Captured

1. **Console methods** - `console.log`, `console.warn`, `console.error`, etc.
2. **Runtime errors** - `window.onerror` (browser) / `ErrorUtils` (React Native)
3. **Unhandled rejections** - `window.onunhandledrejection` / global rejection handler

All original behavior is preserved - logs still appear in DevTools/Metro.

---

## CLI Commands

### Starting the Server

```bash
# Start telemetry server (default port 9876)
devmux telemetry start

# Start on custom port
devmux telemetry start --port 9000

# Check status
devmux telemetry status

# Stop server
devmux telemetry stop
```

### Viewing Streams

```bash
# List active telemetry streams
devmux telemetry status
# Output:
# Telemetry Server: Running (ws://127.0.0.1:9876)
# Active Streams:
#   expo:mingle-ios (45 events, connected 5m ago)
#   browser:localhost-3000 (15 events, connected 2m ago)
#   expo:mingle-web (3 events, connected 30s ago)

# Attach to a stream (uses existing devmux attach)
devmux attach browser:localhost-3000
```

### Configuration

Add to `devmux.config.json`:

```json
{
  "version": 1,
  "project": "my-app",
  "telemetry": {
    "enabled": true,
    "port": 9876,
    "host": "0.0.0.0"  // Use 0.0.0.0 for Expo device testing
  },
  "services": { ... }
}
```

---

## Implementation Phases

### Phase 1: Package Setup (Simple)
- Add packages to workspace
- Configure tsup builds
- Verify `pnpm build` works

### Phase 2: Protocol Types (Moderate)
- Define TypeScript interfaces
- Implement validation
- Mirror types in both packages

### Phase 3: Telemetry Server (Complex)
- WebSocket server with `ws` package
- Session management
- Event routing to tmux + queue
- Pretty-print formatting

### Phase 4: Client SDK (Complex)
- Console monkey-patching (works same in browser + RN)
- Error/rejection capture (platform-specific handlers)
- WebSocket transport with reconnect
- Platform detection (browser vs React Native vs Expo)
- Dev-only activation (__DEV__ or NODE_ENV)

### Phase 5: CLI Integration (Moderate)
- `devmux telemetry` commands
- Server lifecycle management
- Status display

### Phase 6: Testing (Moderate)
- Unit tests for protocol, formatter, session
- Integration tests for server
- Browser tests for SDK

### Phase 7: Documentation (Simple)
- Package READMEs
- Usage examples
- Protocol reference

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Protocol format | **OpenTelemetry-aligned** | Industry standard, future-proof, familiar to developers |
| Client package | **Single universal SDK** | Browser + RN + Expo from one package (like Sentry) |
| Package name | `@chriscode/devmux-telemetry` | Short, not platform-specific |
| Default port | **9876** | Memorable, unlikely to conflict |
| Server daemon | **Separate process** | Cleaner lifecycle, survives CLI exits |
| Protocol types | **Mirrored** | Simpler for MVP, can extract later |

---

## Success Criteria

### MVP Complete When:

1. [ ] Client SDK captures console.* and sends to server (browser + RN)
2. [ ] Client SDK captures errors/rejections and sends to server
3. [ ] Server creates tmux sessions per stream
4. [ ] Server writes events to queue.jsonl
5. [ ] CLI can start/stop/status telemetry server
6. [ ] `devmux attach expo:*` shows live logs from Expo app
7. [ ] `devmux watch queue` shows telemetry events
8. [ ] SDK is dev-only by default (__DEV__)
9. [ ] All tests pass, no type errors
10. [ ] Works in Expo Go on physical device (via IP address)

### Quality Gates:

- `pnpm type-check` passes (no `as any` or suppressions)
- `pnpm build` produces valid bundles
- Protocol validation rejects malformed messages
- Server handles disconnects gracefully

---

## Future Extensions (Not in MVP)

- Node.js client SDK (process stdout/stderr)
- Chrome DevTools extension
- Network request logging (fetch/XHR interception)
- Performance metrics (React Native profiling)
- Replayable log sessions
- Stack trace → editor links (VS Code integration)
- Web UI dashboard (real-time log viewer)
- Full OpenTelemetry export (OTLP backend compatibility)
- Source map support for minified stack traces
