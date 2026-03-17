# Portless Metro: Dynamic Port Assignment for React Native

## Overview

Metro bundler ports can be dynamically assigned (like all other devmux services) without rebuilding the native binary. The native app's runtime `RCT_jsLocation` preference overrides the compiled-in `RCT_METRO_PORT` constant.

## How It Works

```
devmux auto-assigns port 4532
         ↓
Metro starts on :4532
         ↓
Caddy proxies: metro.myapp.localhost:80 → localhost:4532
         ↓
devmux writes: NSUserDefaults["RCT_jsLocation"] = "metro.myapp.localhost"
         ↓
App launches → RCTBundleURLProvider reads jsLocation → ignores compiled-in port → connects to Caddy → Metro
```

## Requirements

- **Standard Expo development build** (not Expo Dev Client — see below)
- Caddy running on port 80 (devmux proxy infrastructure)
- devmux proxy enabled for the project

## devmux.config.json Pattern

```json
{
  "proxy": { "enabled": true },
  "services": {
    "metro": {
      "cwd": "app",
      "command": "RCT_METRO_PORT={{PORT}} npx expo start --port {{PORT}}",
      "proxy": true,
      "onStarted": {
        "inject": {
          "bundleId": "com.yourapp",
          "simulator": "auto"
        }
      }
    }
  }
}
```

The `{{PORT}}` template is replaced by devmux with the auto-assigned port.

## Injecting jsLocation (Current Manual Approach)

Until devmux auto-injects, write the pref manually after Metro starts:

```bash
DEVICE_UDID="<booted-sim-udid>"
BUNDLE_ID="com.yourapp"
PROXY_HOST="metro.myapp.localhost"

PLIST=$(find "$HOME/Library/Developer/CoreSimulator/Devices/$DEVICE_UDID/data/Containers/Data/Application" \
  -name ".com.apple.mobile_container_manager.metadata.plist" 2>/dev/null \
  -exec grep -l "$BUNDLE_ID" {} \; | head -1 | xargs dirname)/Library/Preferences/$BUNDLE_ID.plist

plutil -replace RCT_jsLocation -string "$PROXY_HOST" "$PLIST" 2>/dev/null || \
plutil -insert RCT_jsLocation -string "$PROXY_HOST" "$PLIST"
```

When `RCT_jsLocation` has no colon (just a hostname), iOS appends the compiled-in `RCT_METRO_PORT`. To use port 80 explicitly: `"metro.myapp.localhost:80"`.

## Expo Dev Client Warning

This approach does NOT work on Expo Dev Client builds. Check:

```bash
plutil -p App.app/Info.plist | grep -A3 CFBundleURLSchemes
# "expo-development-client" → dev client (use deep link instead)
# only app scheme → standard build (RCT_jsLocation works)
```

## Verification

Metro logs should show a bundle request after app launch:
```
iOS Bundled 20731ms index.ts (742 modules)
```

Connections visible via:
```bash
lsof -i :<metro-port> | grep ESTABLISHED
```

## HMR Behavior

Metro's HMR WebSocket client (in the bundle) connects to Metro's **actual** port, not the proxy port. On simulator this is transparent (all localhost). On real devices, Metro's actual IP must be reachable — the proxy hostname alone is not sufficient for HMR.

## Automation: Eliminate Per-Project Caddyfile Entries

The per-project Caddyfile block (with WebSocket upgrade headers) can be eliminated entirely. The existing Caddy catch-all already routes `*.localhost` traffic to the devmux proxy. Adding WebSocket upgrade headers to the catch-all makes `proxy: true` on any Metro service fully automatic:

```caddy
http:// {
    reverse_proxy localhost:1355 {
        header_up Upgrade {http.upgrade}
        header_up Connection {http.connection}
    }
}
```

With this catch-all in place, the per-project workflow becomes:

1. Add `proxy: true` and `--port {{PORT}}` to the metro service in `devmux.config.json` (one-time per project)
2. Write `RCT_jsLocation = "metro.<project>.localhost:80"` to the app's plist once per fresh install
3. No Caddyfile editing ever

**Status**: Recommended but not yet applied across all projects. The per-project Caddyfile entries still work and can be migrated incrementally.

## Status

- ✅ Proven working: firefly-phone (com.hasson.fireflyphone) on iOS 18.5 simulator
- ✅ Caddy proxies bundle requests through metro.*.localhost:80
- ✅ HMR WebSocket connections established (direct to Metro port on simulator)
- 🔲 Waypoint — to be verified next
- 🔲 devmux auto-injection of RCT_jsLocation (future devmux feature)
- 🔲 Caddy catch-all WebSocket headers applied (eliminates per-project Caddyfile entries)
