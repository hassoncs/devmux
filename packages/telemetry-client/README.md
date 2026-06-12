# @chriscode/devmux-telemetry

Universal telemetry client for DevMux. Captures console logs and errors from Browser, React Native, and Expo apps and streams them to the DevMux telemetry server.

## Installation

```bash
npm install @chriscode/devmux-telemetry
# or
pnpm add @chriscode/devmux-telemetry
```

## Quick Start

### Browser (Vite, Webpack, etc.)

```typescript
// main.tsx or entry point
import { initTelemetry } from '@chriscode/devmux-telemetry';

initTelemetry({
  serverUrl: 'ws://127.0.0.1:9876',
  serviceName: 'my-web-app',
});

// Your app code...
console.log('This will be captured!');
```

### Expo / React Native

```typescript
// App.tsx or _layout.tsx
import { initTelemetry } from '@chriscode/devmux-telemetry';

initTelemetry({
  // Use your dev machine's IP for physical device testing
  serverUrl: 'ws://192.168.1.100:9876',
  serviceName: 'my-expo-app',
});
```

### Shutdown (Optional)

```typescript
import { shutdownTelemetry } from '@chriscode/devmux-telemetry';

// Call when unmounting or closing
shutdownTelemetry();
```

## Configuration Options

```typescript
interface TelemetryClientOptions {
  // Required
  serverUrl: string;      // WebSocket URL of the telemetry server
  serviceName: string;    // Identifies your app in the telemetry stream

  // Optional
  serviceVersion?: string;   // App version (default: "0.0.0")
  enabled?: boolean;         // Enable telemetry (default: __DEV__ or NODE_ENV !== 'production')
  captureConsole?: boolean;  // Capture console.* methods (default: true)
  captureErrors?: boolean;   // Capture uncaught errors (default: true)
}
```

## What Gets Captured

### Console Methods

All console methods are captured with their original arguments preserved:

- `console.log()` → severity: INFO (9)
- `console.debug()` → severity: DEBUG (5)
- `console.info()` → severity: INFO (9)
- `console.warn()` → severity: WARN (13)
- `console.error()` → severity: ERROR (17)
- `console.trace()` → severity: TRACE (1)

**Original behavior is preserved** - logs still appear in browser DevTools / Metro.

### Errors

- `window.onerror` (browser)
- `window.onunhandledrejection` (browser)
- React Native `ErrorUtils` global handler

Captured errors include:
- Error type and message
- Full stack trace
- Source file, line, and column (when available)
- Whether the error was unhandled

## Platform Detection

The SDK automatically detects the platform:

| Environment | Platform Kind | Stream Name Example |
|-------------|---------------|---------------------|
| Browser | `browser` | `browser:localhost-3000` |
| Expo (iOS) | `expo` | `expo:my-app-ios` |
| Expo (Android) | `expo` | `expo:my-app-android` |
| Expo (Web) | `expo` | `expo:my-app-web` |
| React Native | `react-native` | `rn:my-app-ios` |

## Dev-Only by Default

The SDK is **disabled in production** by default:

- In React Native: checks `__DEV__` global
- In browsers: checks `process.env.NODE_ENV !== 'production'`

To force enable (not recommended for production):

```typescript
initTelemetry({
  serverUrl: 'ws://127.0.0.1:9876',
  serviceName: 'my-app',
  enabled: true,  // Force enable
});
```

## Expo Setup Tips

### Finding Your Dev Machine IP

For Expo on physical devices, you need your dev machine's local IP:

```bash
# macOS
ipconfig getifaddr en0

# Linux
hostname -I | awk '{print $1}'

# Windows
ipconfig | findstr IPv4
```

### Example with Environment Variable

```typescript
// app.config.ts
export default {
  extra: {
    telemetryUrl: process.env.TELEMETRY_URL ?? 'ws://192.168.1.100:9876',
  },
};

// App.tsx
import Constants from 'expo-constants';
import { initTelemetry } from '@chriscode/devmux-telemetry';

if (__DEV__) {
  initTelemetry({
    serverUrl: Constants.expoConfig?.extra?.telemetryUrl,
    serviceName: 'my-expo-app',
  });
}
```

## Protocol

This SDK uses the DevMux Telemetry Protocol, which is aligned with [OpenTelemetry Logs Data Model](https://opentelemetry.io/docs/specs/otel/logs/data-model/):

- **Severity Numbers**: 1-24 scale (TRACE, DEBUG, INFO, WARN, ERROR, FATAL)
- **Structured Body**: Log arguments preserved as JSON, not stringified
- **Attributes**: Additional metadata as key-value pairs
- **Exception Info**: Type, message, and stack trace for errors

## Troubleshooting

### Logs not appearing

1. Check the server is running: `devmux telemetry status`
2. Verify the WebSocket URL is correct
3. For Expo on device: ensure you're using the correct IP (not `localhost`)
4. Check that `enabled` is not set to `false`

### Connection keeps dropping

The SDK automatically reconnects with exponential backoff (up to 10 attempts). If you're seeing frequent disconnects:

1. Check network connectivity
2. Ensure the server isn't being restarted
3. Check firewall settings

### Console logs duplicated

This is expected - the SDK calls the original console method after capturing. Your logs appear both in DevTools AND in the telemetry stream.

## API Reference

### `initTelemetry(options)`

Initialize and start the telemetry client. Safe to call multiple times (returns existing instance).

### `shutdownTelemetry(reason?)`

Stop the telemetry client and restore original console/error handlers.

### `getTelemetryClient()`

Get the current client instance (or `null` if not initialized).

### `TelemetryClient` class

For advanced use cases, you can instantiate directly:

```typescript
import { TelemetryClient } from '@chriscode/devmux-telemetry';

const client = new TelemetryClient({
  serverUrl: 'ws://127.0.0.1:9876',
  serviceName: 'my-app',
});

client.start();

// Manual log
client.log('Custom message', 'info', 9);

client.stop();
```

## License

MIT
