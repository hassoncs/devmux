# @chriscode/devmux-telemetry-server

WebSocket server for DevMux Telemetry. Receives logs from browser/React Native/Expo clients and routes them to tmux sessions and the DevMux error queue.

## Installation

```bash
npm install @chriscode/devmux-telemetry-server
# or
pnpm add @chriscode/devmux-telemetry-server
```

## Quick Start

### Via DevMux CLI (Recommended)

```bash
# Start the server
devmux telemetry start

# Check status
devmux telemetry status

# Stop the server
devmux telemetry stop
```

### Programmatic Usage

```typescript
import { createServer } from '@chriscode/devmux-telemetry-server';

const server = createServer({
  port: 9876,
  host: '0.0.0.0',
});

await server.start();

// Later...
await server.stop();
```

## Configuration

### CLI Options

```bash
devmux telemetry start --port 9876 --host 0.0.0.0
```

### Programmatic Options

```typescript
interface TelemetryServerOptions {
  port?: number;      // Default: 9876
  host?: string;      // Default: '0.0.0.0'
  outputDir?: string; // Default: ~/.opencode/triggers
}
```

### devmux.config.json

```json
{
  "version": 1,
  "project": "my-app",
  "telemetry": {
    "enabled": true,
    "port": 9876,
    "host": "0.0.0.0"
  },
  "services": { ... }
}
```

## How It Works

```
┌─────────────────┐     WebSocket      ┌──────────────────┐
│  Browser/Expo   │ ─────────────────▶ │  Telemetry       │
│  Client SDK     │                    │  Server          │
└─────────────────┘                    └────────┬─────────┘
                                                │
                              ┌─────────────────┼─────────────────┐
                              ▼                 ▼                 ▼
                       ┌───────────┐    ┌─────────────┐   ┌───────────┐
                       │   tmux    │    │ queue.jsonl │   │  stdout   │
                       │  session  │    │  (errors)   │   │  (debug)  │
                       └───────────┘    └─────────────┘   └───────────┘
```

1. **Client connects** and sends `hello` with app info
2. **Server creates** a tmux session for the stream (e.g., `telemetry-browser-localhost-3000`)
3. **Logs stream in** and are formatted/colored in the tmux pane
4. **Errors/warnings** are also written to `~/.opencode/triggers/queue.jsonl`
5. **Client disconnects** or sends `goodbye` → session stays open for viewing

## Viewing Logs

### Attach to a Stream

```bash
# List active streams
devmux telemetry status

# Attach to a specific stream's tmux session
tmux attach -t telemetry-browser-localhost-3000

# Or use devmux attach if you know the stream name
devmux attach telemetry-browser-localhost-3000
```

### View Error Queue

```bash
# See captured errors/warnings
devmux watch queue

# JSON output
devmux watch queue --json

# Clear the queue
devmux watch queue --clear
```

## Protocol

The server implements the DevMux Telemetry Protocol (aligned with OpenTelemetry):

### Message Types

| Type | Direction | Purpose |
|------|-----------|---------|
| `hello` | Client → Server | Establish session, send app info |
| `hello-ack` | Server → Client | Confirm session, return stream name |
| `log` | Client → Server | Send log record |
| `goodbye` | Client → Server | Clean disconnect |
| `error` | Server → Client | Protocol/validation error |

### Log Record (OpenTelemetry-aligned)

```typescript
interface LogPayload {
  timestamp: number;        // Unix milliseconds
  severityNumber: number;   // 1-24 (OTel scale)
  severityText: string;     // "log", "warn", "error", etc.
  body: unknown;            // The actual log content
  attributes?: Record<string, unknown>;
  source?: { file?: string; line?: number; column?: number };
  exception?: {
    type: string;
    message: string;
    stacktrace?: string;
    isUnhandled?: boolean;
  };
}
```

### Severity Numbers (OpenTelemetry Standard)

| Range | Name | Console Method |
|-------|------|----------------|
| 1-4 | TRACE | `console.trace` |
| 5-8 | DEBUG | `console.debug` |
| 9-12 | INFO | `console.log`, `console.info` |
| 13-16 | WARN | `console.warn` |
| 17-20 | ERROR | `console.error`, uncaught errors |
| 21-24 | FATAL | Fatal crashes |

## Stream Naming

Streams are named based on platform and context:

| Platform | Example Stream Name |
|----------|---------------------|
| Browser (localhost:3000) | `browser:localhost-3000` |
| Expo iOS | `expo:my-app-ios` |
| Expo Android | `expo:my-app-android` |
| React Native | `rn:my-app-ios` |
| Node.js | `node:my-cli` |

## tmux Session Format

Each stream gets a tmux session named `telemetry-{stream-name}`:

```
━━━ Telemetry stream: browser:localhost-3000 ━━━
Connected at 2026-01-22T08:00:00.000Z

08:00:01.123 INFO  Hello world
08:00:01.456 WARN  [App.tsx:42:5] Something looks wrong
08:00:01.789 ERROR TypeError: Cannot read property 'foo' of undefined
              at handleClick (Button.tsx:15:10)
              at onClick (App.tsx:42:5)
```

## Queue Event Format

Errors and warnings are written to `~/.opencode/triggers/queue.jsonl`:

```json
{
  "id": "uuid",
  "timestamp": "2026-01-22T08:00:01.789Z",
  "source": "telemetry:browser:localhost-3000",
  "service": "browser:localhost-3000",
  "project": "telemetry",
  "severity": "error",
  "pattern": "telemetry-error",
  "rawContent": "TypeError: Cannot read property 'foo' of undefined",
  "stackTrace": ["at handleClick (Button.tsx:15:10)", "..."],
  "status": "pending",
  "contentHash": "abc123..."
}
```

## API Reference

### `createServer(options?)`

Create a new telemetry server instance.

```typescript
const server = createServer({ port: 9876 });
```

### `TelemetryServer`

#### `start(): Promise<void>`

Start the WebSocket server.

#### `stop(): Promise<void>`

Stop the server and close all connections.

#### `getStatus(): TelemetryServerStatus`

Get current server status including active sessions:

```typescript
interface TelemetryServerStatus {
  running: boolean;
  port: number;
  host: string;
  sessionCount: number;
  sessions: Array<{
    id: string;
    streamName: string;
    serviceName: string;
    platform: string;
    eventCount: number;
    connectedAt: string;
  }>;
}
```

## Network Considerations

### Expo on Physical Devices

When testing Expo apps on physical devices, the device needs to reach your dev machine:

1. **Use your machine's local IP** (not `localhost` or `127.0.0.1`)
2. **Bind to `0.0.0.0`** (default) so the server accepts external connections
3. **Check firewall** - port 9876 needs to be open for local network

```bash
# Find your IP
ipconfig getifaddr en0  # macOS

# Start server (binds to all interfaces by default)
devmux telemetry start
```

### Docker/Container

If running in Docker, expose the port:

```yaml
ports:
  - "9876:9876"
```

## License

MIT
