# Portless Proxy — Named Service URLs on Port 80

DevMux includes a built-in HTTP proxy that routes named hostnames to your
services — no port numbers needed in the browser.

DevMux's built-in proxy story is local-box-first: proxied services live on
`*.localhost` for the machine running devmux.

## How It Works

```
Browser → http://storybook.prism.localhost
       → Caddy (port 80, system LaunchDaemon)
       → storybook (auto-assigned free port, e.g. 4217)
```

1. **Caddy** runs as a macOS LaunchDaemon on port 80, routes by `Host` header directly to the service.
2. When a service with `"proxy": true` and no port starts, devmux calls `findFreePort()` to pick a free port in the 4000–4999 range, injects it as `$PORT` + `{{PORT}}`, and registers the hostname→port mapping via Caddy's admin API.
3. If the managed Caddy LaunchDaemon is installed but not currently serving the admin API, devmux will try to kick it back on during `devmux ensure <service>` before route registration fails. That recovery path covers both a stopped-but-bootstrapped daemon and the `launchctl bootout` state created by `devmux proxy stop`.

> **Routes are ephemeral.** They are re-registered each time you run `devmux ensure <service>`.
> **Lazy start is best-effort.** DevMux will revive an already-installed managed proxy automatically, but it will not auto-install Caddy or prompt for `sudo` during `ensure`.

## System Setup (one-time, per machine)

Fast path on macOS:

```bash
brew install caddy
sudo devmux proxy setup --apply
devmux proxy doctor
```

If you prefer to see the exact shell commands first, run `devmux proxy setup` or
write a reusable installer with `devmux proxy setup --script`.

### 1. Install Caddy

```bash
brew install caddy
```

### 2. Create Caddyfile

```bash
sudo mkdir -p /usr/local/etc/caddy
sudo tee /usr/local/etc/caddy/Caddyfile << 'EOF'
{
    auto_https off
    admin localhost:2019
    default_bind 127.0.0.1
}
EOF
```

> **Routes are managed dynamically** — devmux registers and deregisters routes in Caddy's admin API automatically on `devmux ensure` / `devmux stop`.
> **`default_bind 127.0.0.1`** ensures Caddy only listens on loopback — proxied services are not LAN-visible.

### 3. Install root-owned binary and LaunchDaemon

For security, devmux copies the Caddy binary to a root-owned location during setup to prevent privilege escalation via a user-writable Homebrew path.

```bash
# Detect Homebrew prefix (works on both Apple Silicon and Intel)
BREW_CADDY="$(brew --prefix)/bin/caddy"

# Copy to root-owned location
sudo mkdir -p /usr/local/libexec/devmux
sudo chown root:wheel /usr/local/libexec/devmux
sudo chmod 755 /usr/local/libexec/devmux
sudo cp "$BREW_CADDY" /usr/local/libexec/devmux/caddy
sudo chown root:wheel /usr/local/libexec/devmux/caddy
sudo chmod 755 /usr/local/libexec/devmux/caddy

# Install LaunchDaemon
sudo tee /Library/LaunchDaemons/dev.devmux.caddy.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>dev.devmux.caddy</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/libexec/devmux/caddy</string>
        <string>run</string>
        <string>--config</string>
        <string>/usr/local/etc/caddy/Caddyfile</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/var/log/devmux-caddy.log</string>
    <key>StandardErrorPath</key>
    <string>/var/log/devmux-caddy.err</string>
</dict>
</plist>
EOF

sudo launchctl load -w /Library/LaunchDaemons/dev.devmux.caddy.plist
```

Caddy starts on boot and runs silently in the background.

> **Note:** The LaunchDaemon points at `/usr/local/libexec/devmux/caddy` (root-owned), not the Homebrew path. This means a Homebrew update of Caddy won't automatically reach the LaunchDaemon — run `sudo devmux proxy setup --apply` again after upgrading Caddy to copy the new binary.

> **Why not `pf` redirect?** macOS `pf` cannot redirect loopback-originated traffic (browser → 127.0.0.1). This is a kernel limitation — `rdr` rules on `lo0` are skipped when source and destination are both loopback. Caddy as a LaunchDaemon is the same approach used by Laravel Valet and Herd.

## Per-Project Configuration

Enable the proxy in your `devmux.config.json`:

```json
{
  "version": 1,
  "project": "my-app",
  "proxy": {
    "enabled": true
  },
  "services": {
    "storybook": {
      "cwd": "packages/storybook",
      "command": "npx storybook dev --port {{PORT}} --no-open",
      "proxy": true
    },
    "web": {
      "cwd": ".",
      "command": "pnpm dev --port {{PORT}}",
      "proxy": true
    }
  }
}
```

Key points:

- `"proxy": { "enabled": true }` — turns on the proxy for this project
- `"proxy": true` on a service — opts the service into portless routing
- No `health` or `port` needed — devmux auto-assigns and creates a port health check
- `{{PORT}}` in the command is replaced with the assigned port at startup
- `$PORT` / `$DEVMUX_PORT` env vars are also set for frameworks that read from env

The service will be available at: `http://<service>.<project>.localhost`

## Hostname Pattern

Default: `{service}.{project}.localhost`

That hostname always refers to the current box running devmux. If you want a
different local shape, set `proxy.hostnamePattern` in that repo, but it still
must resolve to `*.localhost`. Devmux will not pick up a machine-wide hostname
override for proxy routes, and local proxy config is not the place for external
network naming.

Override per project in the config if you want something shorter on the same
machine:

```json
{
  "proxy": {
    "enabled": true,
    "hostnamePattern": "{service}.localhost"
  }
}
```

Non-`.localhost` hostname patterns are rejected for local devmux proxy routing.

## Services with Fixed Ports

Services that need a specific port (e.g. Cloudflare Workers on 8787) keep their existing config — just add `"proxy": true` and the fixed port will be used as-is:

```json
{
  "services": {
    "api": {
      "cwd": ".",
      "command": "pnpm dev",
      "health": { "type": "port", "port": 8787 },
      "proxy": true
    }
  }
}
```

This gives you `http://api.my-app.localhost` as an alias alongside `http://localhost:8787`.

## What NOT to Migrate

Some ports are too tightly coupled to their tooling to use `{{PORT}}`:

- **React Native / Expo Metro** — port 8081 (and 19000–19002) is hardcoded in native build tooling and cannot be overridden via env. Leave these with explicit port configs and no `"proxy": true`.

## Viewing Active Routes

```bash
devmux proxy doctor     # Diagnose the managed Caddy setup
devmux proxy routes     # List all active hostname → port mappings
devmux status           # Shows proxyUrl for each proxied service
```

## Port Range

Auto-assigned ports are picked randomly from 4000–4999. DevMux tries up to 50 random ports before scanning sequentially. The port is consistent per service run (not pinned between restarts).

## Teardown

To remove the managed proxy from your machine:

```bash
# Automated (uses sudo internally)
sudo devmux proxy teardown --apply
```

Or manually:
```bash
sudo launchctl bootout system/dev.devmux.caddy
sudo rm -f /Library/LaunchDaemons/dev.devmux.caddy.plist
sudo rm -f /usr/local/etc/caddy/Caddyfile
sudo rmdir /usr/local/etc/caddy 2>/dev/null || true
sudo rm -rf /usr/local/libexec/devmux
```

This removes the LaunchDaemon, Caddyfile, and root-owned binary. The Homebrew `caddy` installation is left untouched.
