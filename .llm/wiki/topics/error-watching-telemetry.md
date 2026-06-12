# Topic: Error Watching & Telemetry

## Purpose

Two complementary systems for capturing errors automatically during development:
1. **Error Watching** — monitors tmux service log output via `pipe-pane` for regex error patterns
2. **Browser/App Telemetry** — WebSocket server that receives console logs and errors from browser/RN apps

Both systems feed errors into a shared JSONL queue for later processing.

## Normative Rules

- Watchers MUST run as child processes of `tmux pipe-pane` — they receive stdout via stdin
- Each log line MUST be checked against configured regex patterns
- Stack trace lines MUST be accumulated separately from the error line (with a 500ms flush timeout)
- Duplicate errors MUST be deduplicated within a configurable time window using content hashing
- Context MUST include the preceding N lines (configurable, default 20) before the error
- Errors MUST be written to a JSONL file at the configured `outputDir`
- Telemetry clients MUST be able to reconnect with configurable retry settings
- Console errors MUST be routed to both tmux session AND the error queue
- Pattern sets MUST be opt-in — services must explicitly include them

## How It Works

### Error Watching

Core watcher in `devmux-cli/src/watch/watcher.ts` (89 lines):

Uses Node.js `readline.createInterface()` on `process.stdin` — this is how it receives piped output from `tmux pipe-pane`.

**Line-by-line processing** (line 40):
1. If currently accumulating a stack trace, checks if the line continues it. If yes, appends and returns. If no, flushes the accumulated stack.
2. Pushes the line into a ring buffer (context history).
3. Matches the line against all configured patterns via `matchPatterns()`.
4. If match found, computes a content hash (`service:patternName:line`) and checks the dedupe cache.
5. If not a duplicate, writes the event to the queue.

**Stack trace accumulation** (lines 41-68): When a pattern has `extractStackTrace: true`, the watcher enters accumulation mode. It collects subsequent lines that match `isStackTraceLine()` (typically lines starting with whitespace and "at"). After 500ms of no new stack lines (`setTimeout`), it flushes the accumulated stack trace.

**Signal handling** (lines 75-88): On stream close, SIGTERM, or SIGINT, flushes any in-progress stack trace and exits.

### Deduplication

In `devmux-cli/src/watch/deduper.ts`:

- **Ring buffer**: Circular buffer of configurable size (default 20 lines) for context before the error
- **DedupeCache**: Time-window based deduplication. Uses content hash to track recently seen errors. If the same hash appears within `dedupeWindowMs` (default 5000ms), it's suppressed.

### Queue

In `devmux-cli/src/watch/queue.ts`:

Writes JSONL to `~/.devmux/queue.jsonl`. Each line is a JSON object with:
- `id` (UUID), `timestamp` (ISO 8601), `source` ("devmux:{service}"), `service`, `project`
- `severity`, `pattern` (name), `rawContent` (the matched line)
- `context` (preceding lines from ring buffer)
- `stackTrace` (accumulated stack lines, if any)
- `status` ("pending"), `contentHash`, `firstSeen`

### Built-in Pattern Sets

Defined in `devmux-cli/src/watch/patterns.ts` as `BUILTIN_PATTERN_SETS`:

| Set | Patterns | Use case |
|---|---|---|
| `node` | js-error, type-error, unhandled-rejection, oom | Node.js services |
| `web` | http-5xx, http-4xx-important | HTTP APIs |
| `react` | react-error | React apps |
| `nextjs` | webpack-error, hydration-error | Next.js apps |
| `database` | db-error | Database connections |
| `fatal` | fatal | System crashes (PANIC, SIGSEGV) |
| `python` | exception | Python services |

Pattern sets are **opt-in**. A service must explicitly `"include": ["node", "web"]` in its watch config.

### Watcher Management

In `devmux-cli/src/watch/manager.ts`: Manages starting and stopping watcher processes for services. Each watcher is a separate process that pipes tmux output through the watcher binary.

### Browser/App Telemetry

**Telemetry Server** (`@chriscode/devmux-telemetry-server`):

WebSocket server (default: `ws://127.0.0.1:9876`). Receives log events from client SDKs. Streams console output to a dedicated tmux session and routes errors to the error queue.

**Telemetry Client** (`@chriscode/devmux-telemetry-client`):

SDK for browser and React Native apps. Intercepts `console.log/info/debug/warn/error`, uncaught exceptions, unhandled promise rejections, and React error boundaries. Sends formatted log payloads over WebSocket.

Protocol matches OpenTelemetry log format:
```typescript
interface LogPayload {
  severityNumber: number;    // 1-24 (OTEL severity)
  severityText: string;      // "DEBUG", "INFO", "WARN", "ERROR"
  body: string;              // Log message
  timestamp: string;         // ISO 8601
  attributes?: Record<string, unknown>;
  exception?: { type: string; message: string; stacktrace?: string };
}
```

### Configuration

```json
{
  "watch": {
    "enabled": true,
    "outputDir": "~/.devmux",
    "dedupeWindowMs": 5000,
    "contextLines": 20,
    "patternSets": { "my-custom": [{ "name": "my-error", "regex": "MyError:", "severity": "error" }] }
  },
  "services": {
    "api": {
      "watch": { "enabled": true, "include": ["node", "web"] }
    }
  }
}
```

## Key Files

| File | Role |
|---|---|
| `devmux-cli/src/watch/watcher.ts` | Core stdin-based log watcher (89 lines) |
| `devmux-cli/src/watch/patterns.ts` | Builtin pattern sets, regex matching, stack trace detection |
| `devmux-cli/src/watch/deduper.ts` | Ring buffer, time-window deduplication |
| `devmux-cli/src/watch/queue.ts` | JSONL file I/O |
| `devmux-cli/src/watch/manager.ts` | Watcher process lifecycle |
| `devmux-cli/src/watch/watcher-cli.ts` | CLI entry point for pipe-pane |
| `devmux-cli/src/config/types.ts` — ServiceWatchConfig, GlobalWatchConfig, ErrorPatternConfig |

## Edge Cases

- **Stack trace timeout**: The 500ms flush timeout means slow-printing stack traces might get truncated. This is a tradeoff to avoid waiting indefinitely for the next line.
- **Dedupe window**: 5-second default means rapidly repeating errors (e.g., in a tight loop) are only captured once per 5 seconds.
- **Context buffer**: Ring buffer size is fixed at config time. Very large context lines increase memory per watcher process.
- **pipe-pane dependency**: Watchers only work when `tmux pipe-pane` is active. If a service stops piping output (e.g., after a crash), the watcher process also exits.
- **Telemetry client on physical devices**: For React Native on a physical phone, `serverUrl` must point to the dev machine's IP, not `localhost`.
- **Custom pattern sets**: Users can define new pattern sets in `watch.patternSets` and reference them by name in service `watch.include`.

## Source Attribution

- `devmux-cli/src/watch/watcher.ts` — startWatcher (line 14), stack accumulation (line 41), line processing (line 40), signal handling (line 75)
- `devmux-cli/src/watch/patterns.ts` — BUILTIN_PATTERN_SETS, matchPatterns, isStackTraceLine
- `devmux-cli/src/watch/deduper.ts` — DedupeCache, createRingBuffer
- `devmux-cli/src/watch/queue.ts` — writeEvent
- `devmux-cli/src/watch/manager.ts` — Watcher lifecycle management
- `devmux-cli/src/config/types.ts` — ServiceWatchConfig (line 20), GlobalWatchConfig (line 12), ErrorPatternConfig (line 5)
- `@chriscode/devmux-telemetry-server` — WebSocket server for browser logs
- `@chriscode/devmux-telemetry-client` — Client SDK for browser/RN apps
