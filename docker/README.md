# Universal Bot Town Daemon Setup

This directory contains the containerized daemon infrastructure for Bot Town, supporting Mac, Dell (LXC), and Fly.io deployments.

## Quick Start

```bash
# Build and deploy to local Mac
docker build -t bottown-daemon -f docker/Dockerfile.daemon .
docker-compose -f docker/docker-compose.daemon.yml up -d

# Or use the deployment script
chmod +x scripts/deploy-daemon.sh
./scripts/deploy-daemon.sh mac --node-id mac-daemon-1

# Deploy to Dell
./scripts/deploy-daemon.sh dell --node-id dell-worker-1

# Deploy to Fly.io
./scripts/deploy-daemon.sh fly --node-id fly-worker-1 --push
```

## Files

| File | Purpose |
|------|---------|
| `Dockerfile.daemon` | Universal Docker image with Bot Town daemon + DevTools + OpenCode |
| `docker-compose.daemon.yml` | Docker Compose configuration for local deployment |
| `healthcheck.js` | Container health check endpoint |

## DevTools Included

All containers include:
- `rg` (ripgrep) - Fast code search
- `fd` - Modern find replacement
- `jq` - JSON processor
- `fzf` - Fuzzy finder
- `bat` - Cat with syntax highlighting
- `eza` - Modern ls replacement
- `git`, `ssh`, `rsync`, `curl`, `wget`

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TOWN_SERVER_URL` | Yes | - | Bot Town runtime WebSocket endpoint |
| `DAEMON_NODE_ID` | No | auto | Unique node identifier |
| `DAEMON_KIND` | No | server | `laptop`, `server`, or `cloud` |
| `DAEMON_CAPABILITIES` | No | opencode,git,browser | Comma-separated capabilities |
| `DAEMON_AUTH_TOKEN` | No | - | Bearer token for WebSocket auth |
| `PREWARM_ROOMS` | No | - | JSON array of agents to keep warm |
| `HEARTBEAT_INTERVAL_MS` | No | 30000 | Heartbeat interval in milliseconds |

## OpenCode Ecosystem Sync

Sync your OpenCode configuration, plugins, and skills to all daemon nodes:

```bash
# Sync to Mac container
./scripts/sync-opencode.sh sync-mac

# Sync to Dell LXC
./scripts/sync-opencode.sh sync-dell

# Sync to Fly.io (via secrets)
./scripts/sync-opencode.sh sync-fly

# Sync to all targets
./scripts/sync-opencode.sh sync-all

# Create backup
./scripts/sync-opencode.sh backup
```

## Health Monitoring

Check daemon health:

```bash
# Local container
curl http://localhost:4096/health

# Via Docker
docker ps --filter "name=bottown-daemon"

# View logs
docker-compose -f docker/docker-compose.daemon.yml logs -f daemon
```

## Multi-Platform Builds

Build for both ARM64 (Mac) and AMD64 (Dell/Fly):

```bash
docker buildx create --use
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t bottown-daemon:latest \
  -f docker/Dockerfile.daemon .
```

## Troubleshooting

### Container won't start
Check logs: `docker-compose logs daemon`

### Tools not found
Verify in container: `docker run --rm bottown-daemon which rg fd jq`

### Cannot connect to Bot Town runtime
- Ensure `TOWN_SERVER_URL` is set correctly
- Check network connectivity to town.lan:8091
- Verify firewall rules allow WebSocket connections

### OpenCode skills not syncing
- Ensure `~/.claude/skills` exists on host
- Check volume mount in docker-compose.yml
- Run `./scripts/sync-opencode.sh sync-mac` to force sync

## Architecture

```
┌─────────────┐     WebSocket      ┌─────────────────┐
│   Mac       │◄──────────────────►│  Bot Town       │
│  Daemon     │                    │  Runtime        │
└─────────────┘                    │  (town.lan)     │
                                   └────────┬────────┘
┌─────────────┐     WebSocket              │
│  Dell LXC   │◄───────────────────────────┤
│  Daemon     │                            │
└─────────────┘                            │
                                           │
┌─────────────┐     WebSocket              │
│  Fly.io     │◄───────────────────────────┘
│  Worker     │
└─────────────┘
```

Each daemon node:
1. Connects to Bot Town runtime via WebSocket
2. Accepts work dispatches (session creation, prompts)
3. Spawns OpenCode agents locally
4. Streams events back to runtime
5. Publishes heartbeats for health monitoring
