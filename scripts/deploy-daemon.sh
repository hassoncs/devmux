#!/usr/bin/env bash
# =============================================================================
# Universal Daemon Deployment Script
# Supports: Mac (local), Dell (LXC), Fly.io (cloud)
# =============================================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DOCKERFILE="${PROJECT_ROOT}/docker/Dockerfile.daemon"
COMPOSE_FILE="${PROJECT_ROOT}/docker/docker-compose.daemon.yml"
IMAGE_NAME="bottown-daemon"
IMAGE_TAG="latest"

# Target configuration
TARGET=""
DAEMON_NODE_ID=""
TOWN_SERVER_URL=""
DRY_RUN=false
BUILD_ONLY=false
PUSH=false

# Show usage
usage() {
    cat << EOF
Usage: $(basename "$0") <target> [options]

Targets:
  mac          Deploy to local Mac (Docker Desktop)
  dell         Deploy to Dell LXC (via SSH)
  fly          Deploy to Fly.io (cloud workers)
  local        Build and run locally (for testing)

Options:
  -n, --node-id ID        Set daemon node ID (auto-generated if not set)
  -t, --town-url URL      Set Bot Town runtime URL (default: ws://town.lan:8091)
  -d, --dry-run           Show what would be done without executing
  -b, --build-only        Only build image, don't deploy
  -p, --push              Push image to registry after build
  -h, --help              Show this help message

Environment Variables:
  DAEMON_AUTH_TOKEN       Bearer token for WebSocket auth
  DAEMON_CAPABILITIES     Comma-separated capabilities (default: opencode,git,browser)
  PREWARM_ROOMS           JSON array of agents to pre-warm

Examples:
  $(basename "$0") mac --node-id mac-worker-1
  $(basename "$0") dell --node-id dell-lxc-201
  $(basename "$0") fly --node-id fly-worker-1 --push
  $(basename "$0") local --build-only

EOF
}

# Log functions
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Parse command line arguments
parse_args() {
    if [[ $# -eq 0 ]]; then
        usage
        exit 1
    fi

    TARGET="$1"
    shift

    while [[ $# -gt 0 ]]; do
        case "$1" in
            -n|--node-id)
                DAEMON_NODE_ID="$2"
                shift 2
                ;;
            -t|--town-url)
                TOWN_SERVER_URL="$2"
                shift 2
                ;;
            -d|--dry-run)
                DRY_RUN=true
                shift
                ;;
            -b|--build-only)
                BUILD_ONLY=true
                shift
                ;;
            -p|--push)
                PUSH=true
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
    done

    # Set defaults based on target
    case "$TARGET" in
        mac)
            DAEMON_NODE_ID="${DAEMON_NODE_ID:-mac}"
            TOWN_SERVER_URL="${TOWN_SERVER_URL:-ws://town.lan:8091}"
            ;;
        dell)
            DAEMON_NODE_ID="${DAEMON_NODE_ID:-dell}"
            TOWN_SERVER_URL="${TOWN_SERVER_URL:-ws://town.lan:8091}"
            ;;
        fly)
            DAEMON_NODE_ID="${DAEMON_NODE_ID:-}"
            TOWN_SERVER_URL="${TOWN_SERVER_URL:-ws://town.lan:8091}"
            ;;
        local)
            DAEMON_NODE_ID="${DAEMON_NODE_ID:-local-test}"
            TOWN_SERVER_URL="${TOWN_SERVER_URL:-ws://town.lan:8091}"
            ;;
        *)
            log_error "Unknown target: $TARGET"
            usage
            exit 1
            ;;
    esac
}

# Check prerequisites
check_prereqs() {
    log_info "Checking prerequisites..."

    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install Docker first."
        exit 1
    fi

    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        log_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi

    # Check for Dell SSH access
    if [[ "$TARGET" == "dell" ]]; then
        if ! command -v ssh &> /dev/null; then
            log_error "SSH is not installed."
            exit 1
        fi
        # Check SSH key for Dell
        if [[ ! -f ~/.ssh/id_rsa ]] && [[ ! -f ~/.ssh/id_ed25519 ]]; then
            log_warn "No SSH key found in ~/.ssh/. You may need to authenticate manually."
        fi
    fi

    # Check for Fly CLI
    if [[ "$TARGET" == "fly" ]]; then
        if ! command -v fly &> /dev/null; then
            log_error "Fly CLI is not installed. Install with: brew install flyctl"
            exit 1
        fi
        if ! fly auth whoami &> /dev/null; then
            log_error "Not authenticated with Fly. Run: fly auth login"
            exit 1
        fi
    fi

    log_success "Prerequisites check passed"
}

# Build Docker image
build_image() {
    log_info "Building Docker image..."

    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY RUN] Would build: docker build -t ${IMAGE_NAME}:${IMAGE_TAG} -f ${DOCKERFILE} ${PROJECT_ROOT}"
        return 0
    fi

    # Ensure we're in the project root
    cd "$PROJECT_ROOT"

    # Build with progress output
    docker build \
        --platform linux/amd64,linux/arm64 \
        --tag "${IMAGE_NAME}:${IMAGE_TAG}" \
        --file "$DOCKERFILE" \
        --build-arg BUILDKIT_INLINE_CACHE=1 \
        --progress=plain \
        . 2>&1 | tee /tmp/docker-build.log

    if [[ ${PIPESTATUS[0]} -ne 0 ]]; then
        log_error "Docker build failed. See /tmp/docker-build.log for details."
        exit 1
    fi

    log_success "Docker image built: ${IMAGE_NAME}:${IMAGE_TAG}"

    # Verify tools are available
    log_info "Verifying tools in container..."
    docker run --rm "${IMAGE_NAME}:${IMAGE_TAG}" sh -c "
        which rg && rg --version | head -1
        which fd && fd --version
        which jq && jq --version
        which fzf && echo 'fzf: installed'
        which bat && bat --version | head -1
        which eza && eza --version | head -1
        which opencode && opencode --version
    " || {
        log_warn "Some tools may not be properly installed. Check output above."
    }
}

# Deploy to Mac (local Docker)
deploy_mac() {
    log_info "Deploying to Mac (Docker Desktop)..."

    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY RUN] Would run: docker-compose up -d"
        return 0
    fi

    # Export environment variables for docker-compose
    export DAEMON_NODE_ID
    export TOWN_SERVER_URL
    export OPENCODE_CONFIG_PATH="${HOME}/.config/opencode"
    export OPENCODE_SKILLS_PATH="${HOME}/.claude/skills"

    # Create network if it doesn't exist
    docker network create bottown-daemon 2>/dev/null || true

    # Start with docker-compose
    docker-compose -f "$COMPOSE_FILE" up -d --remove-orphans

    log_success "Daemon deployed to Mac"
    log_info "Node ID: $DAEMON_NODE_ID"
    log_info "Logs: docker-compose -f docker/docker-compose.daemon.yml logs -f daemon"
}

# Deploy to Dell (via SSH)
deploy_dell() {
    log_info "Deploying to Dell LXC..."

    local DELL_HOST="${DELL_HOST:-root@192.168.1.201}"
    local DELL_DAEMON_DIR="/opt/automation/bottown-daemon"

    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY RUN] Would SSH to $DELL_HOST and deploy"
        return 0
    fi

    # Build and save image
    log_info "Preparing image for Dell..."
    docker save "${IMAGE_NAME}:${IMAGE_TAG}" | gzip > /tmp/bottown-daemon.tar.gz

    # Copy files to Dell
    log_info "Copying files to Dell..."
    ssh "$DELL_HOST" "mkdir -p ${DELL_DAEMON_DIR}"
    scp /tmp/bottown-daemon.tar.gz "$DELL_HOST:${DELL_DAEMON_DIR}/"
    scp "$COMPOSE_FILE" "$DELL_HOST:${DELL_DAEMON_DIR}/docker-compose.yml"

    # Deploy on Dell
    log_info "Starting daemon on Dell..."
    ssh "$DELL_HOST" << EOF
        cd ${DELL_DAEMON_DIR}
        docker load < bottown-daemon.tar.gz
        DAEMON_NODE_ID="${DAEMON_NODE_ID}" \
        TOWN_SERVER_URL="${TOWN_SERVER_URL}" \
        docker-compose -f docker-compose.yml up -d
        rm -f bottown-daemon.tar.gz
EOF

    log_success "Daemon deployed to Dell"
    log_info "Node ID: $DAEMON_NODE_ID"
}

# Deploy to Fly.io
deploy_fly() {
    log_info "Deploying to Fly.io..."

    local FLY_APP="${FLY_APP:-bottown-worker}"

    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY RUN] Would deploy to Fly.io app: $FLY_APP"
        return 0
    fi

    # Ensure fly.toml exists or create it
    if [[ ! -f "${PROJECT_ROOT}/fly.toml" ]]; then
        log_info "Creating fly.toml..."
        cat > "${PROJECT_ROOT}/fly.toml" << EOF
app = "${FLY_APP}"
primary_region = "iad"

[build]
  dockerfile = "docker/Dockerfile.daemon"

[env]
  DAEMON_NODE_ID_TEMPLATE = "fly-\${FLY_APP_NAME}-\${FLY_MACHINE_ID}"
  DAEMON_KIND = "cloud"
  DAEMON_CAPABILITIES = "opencode,git,browser"
  TOWN_SERVER_URL = "${TOWN_SERVER_URL}"
  OPENCODE_WORKER_MODE = "native"
  HEARTBEAT_INTERVAL_MS = "30000"

[[services]]
  internal_port = 4096
  protocol = "tcp"
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0

  [[services.ports]]
    port = 4096
    handlers = ["http"]

[[metrics]]
  port = 4096
  path = "/metrics"
EOF
    fi

    # Set secrets
    if [[ -n "${DAEMON_AUTH_TOKEN:-}" ]]; then
        fly secrets set DAEMON_AUTH_TOKEN="$DAEMON_AUTH_TOKEN" --app "$FLY_APP" || true
    fi
    fly secrets set TOWN_SERVER_URL="$TOWN_SERVER_URL" --app "$FLY_APP" || true

    # Deploy
    fly deploy --app "$FLY_APP"

    log_success "Daemon deployed to Fly.io"
    log_info "App: $FLY_APP"
    log_info "URL: https://fly.io/apps/$FLY_APP"
}

# Run local test
run_local() {
    log_info "Running local test..."

    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY RUN] Would run: docker run --rm -it ..."
        return 0
    fi

    export DAEMON_NODE_ID
    export TOWN_SERVER_URL
    export OPENCODE_CONFIG_PATH="${HOME}/.config/opencode"
    export OPENCODE_SKILLS_PATH="${HOME}/.claude/skills"

    docker-compose -f "$COMPOSE_FILE" up --remove-orphans
}

# Push image to registry
push_image() {
    log_info "Pushing image to registry..."

    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY RUN] Would push: docker push ${IMAGE_NAME}:${IMAGE_TAG}"
        return 0
    fi

    # Tag for registry
    local REGISTRY="${DOCKER_REGISTRY:-registry.fly.io}"
    docker tag "${IMAGE_NAME}:${IMAGE_TAG}" "${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"
    docker push "${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"

    log_success "Image pushed to ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"
}

# Verify deployment
verify_deployment() {
    log_info "Verifying deployment..."

    case "$TARGET" in
        mac|local)
            if docker-compose -f "$COMPOSE_FILE" ps | grep -q "Up"; then
                log_success "Container is running"
                docker-compose -f "$COMPOSE_FILE" logs --tail=20 daemon
            else
                log_error "Container is not running"
                docker-compose -f "$COMPOSE_FILE" logs daemon
                exit 1
            fi
            ;;
        dell)
            log_info "Verify manually: ssh ${DELL_HOST:-root@192.168.1.201} 'docker ps'"
            ;;
        fly)
            log_info "Verify manually: fly status --app ${FLY_APP:-bottown-worker}"
            ;;
    esac
}

# Main function
main() {
    log_info "Bot Town Universal Daemon Deploy Script"
    log_info "Target: $TARGET"
    log_info "Node ID: $DAEMON_NODE_ID"
    log_info "Town URL: $TOWN_SERVER_URL"
    echo

    check_prereqs
    build_image

    if [[ "$BUILD_ONLY" == true ]]; then
        log_info "Build complete. Exiting."
        exit 0
    fi

    if [[ "$PUSH" == true ]]; then
        push_image
    fi

    case "$TARGET" in
        mac)
            deploy_mac
            ;;
        dell)
            deploy_dell
            ;;
        fly)
            deploy_fly
            ;;
        local)
            run_local
            ;;
    esac

    verify_deployment

    echo
    log_success "Deployment complete!"
}

# Run main
parse_args "$@"
main
