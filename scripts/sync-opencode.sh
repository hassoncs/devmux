#!/usr/bin/env bash
# =============================================================================
# OpenCode Ecosystem Mirror Script
# Synchronizes plugins, skills, and configuration across daemon nodes
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Source and target paths
SOURCE_CONFIG="${HOME}/.config/opencode"
SOURCE_SKILLS="${HOME}/.claude/skills"
SOURCE_LOCAL_SHARE="${HOME}/.local/share/opencode"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Show usage
usage() {
    cat << EOF
Usage: $(basename "$0") <command> [options]

Commands:
  sync-mac      Sync OpenCode config to Mac daemon container
  sync-dell     Sync OpenCode config to Dell LXC
  sync-fly      Sync OpenCode config to Fly.io (via secrets)
  sync-all      Sync to all targets
  backup        Create backup of current config
  restore       Restore from backup
  list          List sync targets and status

Options:
  -s, --source PATH       Override source config path
  -t, --target PATH       Override target path
  -n, --dry-run           Show what would be synced
  -f, --force             Force overwrite without confirmation
  -h, --help              Show this help message

Examples:
  $(basename "$0") sync-mac
  $(basename "$0") sync-dell --dry-run
  $(basename "$0") sync-all --force
  $(basename "$0") backup

EOF
}

# Check source files exist
check_source() {
    log_info "Checking source files..."

    if [[ ! -d "$SOURCE_CONFIG" ]]; then
        log_error "Source config not found: $SOURCE_CONFIG"
        exit 1
    fi

    if [[ ! -d "$SOURCE_SKILLS" ]]; then
        log_warn "Source skills not found: $SOURCE_SKILLS"
    fi

    log_success "Source files verified"
}

# Get config checksum for comparison
get_checksum() {
    local path="$1"
    if [[ -d "$path" ]]; then
        find "$path" -type f -exec md5sum {} \; 2>/dev/null | sort | md5sum | cut -d' ' -f1
    else
        echo "0"
    fi
}

# Sync to Mac (local Docker container)
sync_mac() {
    log_info "Syncing to Mac daemon container..."

    local DRY_RUN="${1:-}"
    local container_name="bottown-daemon-mac"

    # Check if container is running
    if ! docker ps --format '{{.Names}}' | grep -q "^${container_name}$"; then
        log_warn "Mac daemon container not running: $container_name"
        log_info "Start it with: docker-compose -f docker/docker-compose.daemon.yml up -d"
        return 1
    fi

    # Create temp tarball
    local temp_dir=$(mktemp -d)
    local tarball="${temp_dir}/opencode-config.tar.gz"

    log_info "Creating config archive..."
    tar -czf "$tarball" -C "$SOURCE_CONFIG" . 2>/dev/null || true

    if [[ -d "$SOURCE_SKILLS" ]]; then
        tar -czf "${temp_dir}/skills.tar.gz" -C "$SOURCE_SKILLS" . 2>/dev/null || true
    fi

    # Copy to container
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY RUN] Would copy to container: $container_name"
    else
        log_info "Copying to container..."
        docker cp "$tarball" "${container_name}:/tmp/opencode-config.tar.gz"
        docker exec "$container_name" bash -c "
            mkdir -p /workspace/.config/opencode
            cd /workspace/.config/opencode && tar -xzf /tmp/opencode-config.tar.gz
            rm -f /tmp/opencode-config.tar.gz
        "

        if [[ -f "${temp_dir}/skills.tar.gz" ]]; then
            docker cp "${temp_dir}/skills.tar.gz" "${container_name}:/tmp/skills.tar.gz"
            docker exec "$container_name" bash -c "
                mkdir -p /workspace/.claude/skills
                cd /workspace/.claude/skills && tar -xzf /tmp/skills.tar.gz
                rm -f /tmp/skills.tar.gz
            "
        fi

        log_success "Synced to Mac daemon container"
    fi

    rm -rf "$temp_dir"
}

# Sync to Dell (via SSH)
sync_dell() {
    log_info "Syncing to Dell LXC..."

    local DRY_RUN="${1:-}"
    local DELL_HOST="${DELL_HOST:-root@192.168.1.201}"
    local DELL_DAEMON_DIR="/opt/automation/bottown-daemon"
    local DELL_CONFIG_DIR="${DELL_DAEMON_DIR}/config"

    # Check SSH connectivity
    if ! ssh -q "$DELL_HOST" exit 2>/dev/null; then
        log_error "Cannot connect to Dell via SSH: $DELL_HOST"
        return 1
    fi

    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY RUN] Would sync to Dell at $DELL_HOST"
        log_info "[DRY RUN] Source: $SOURCE_CONFIG -> $DELL_CONFIG_DIR/opencode"
        log_info "[DRY RUN] Source: $SOURCE_SKILLS -> $DELL_CONFIG_DIR/skills"
        return 0
    fi

    # Create remote directories
    ssh "$DELL_HOST" "mkdir -p ${DELL_CONFIG_DIR}/opencode ${DELL_CONFIG_DIR}/skills"

    # Sync config files
    log_info "Syncing config files..."
    rsync -avz --delete \
        --exclude='*.log' \
        --exclude='cache/' \
        --exclude='opencode.db*' \
        "$SOURCE_CONFIG/" \
        "${DELL_HOST}:${DELL_CONFIG_DIR}/opencode/"

    # Sync skills
    if [[ -d "$SOURCE_SKILLS" ]]; then
        log_info "Syncing skills..."
        rsync -avz --delete \
            "$SOURCE_SKILLS/" \
            "${DELL_HOST}:${DELL_CONFIG_DIR}/skills/"
    fi

    log_success "Synced to Dell LXC"
}

# Sync to Fly.io (via secrets and volumes)
sync_fly() {
    log_info "Syncing to Fly.io..."

    local DRY_RUN="${1:-}"
    local FLY_APP="${FLY_APP:-bottown-worker}"

    # Check Fly CLI
    if ! command -v fly &> /dev/null; then
        log_error "Fly CLI not installed"
        return 1
    fi

    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY RUN] Would create secrets for Fly app: $FLY_APP"
        return 0
    fi

    # Create tarball of config
    local temp_dir=$(mktemp -d)
    local config_tar="${temp_dir}/opencode-config.tar.gz"

    log_info "Creating config archive..."
    tar -czf "$config_tar" -C "$SOURCE_CONFIG" .

    # Base64 encode for secret
    local config_b64=$(base64 < "$config_tar")

    # Set as Fly secret
    log_info "Setting Fly secret..."
    echo "$config_b64" | fly secrets set OPENCODE_CONFIG_B64="-" --app "$FLY_APP"

    # Cleanup
    rm -rf "$temp_dir"

    log_success "Synced to Fly.io"
    log_warn "Fly.io deployment will extract config on next restart"
}

# Create backup
backup_config() {
    log_info "Creating backup..."

    local backup_dir="${HOME}/.local/share/opencode-daemon/backups"
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_name="opencode-config-${timestamp}"
    local backup_path="${backup_dir}/${backup_name}.tar.gz"

    mkdir -p "$backup_dir"

    # Create backup
    tar -czf "$backup_path" \
        -C "$SOURCE_CONFIG" . \
        -C "$SOURCE_SKILLS" . \
        2>/dev/null || tar -czf "$backup_path" -C "$SOURCE_CONFIG" .

    log_success "Backup created: $backup_path"
    echo "$backup_path"
}

# Restore from backup
restore_config() {
    local backup_path="$1"

    if [[ -z "$backup_path" ]]; then
        # List available backups
        local backup_dir="${HOME}/.local/share/opencode-daemon/backups"
        log_info "Available backups:"
        ls -la "$backup_dir"/*.tar.gz 2>/dev/null || {
            log_error "No backups found in $backup_dir"
            exit 1
        }
        echo
        read -p "Enter backup filename to restore: " backup_path

        if [[ ! "$backup_path" =~ ^/ ]]; then
            backup_path="${backup_dir}/${backup_path}"
        fi
    fi

    if [[ ! -f "$backup_path" ]]; then
        log_error "Backup not found: $backup_path"
        exit 1
    fi

    log_warn "This will overwrite your current OpenCode config!"
    read -p "Are you sure? (yes/no): " confirm

    if [[ "$confirm" != "yes" ]]; then
        log_info "Restore cancelled"
        exit 0
    fi

    # Backup current config first
    log_info "Backing up current config..."
    backup_config

    # Extract backup
    log_info "Restoring from backup..."
    tar -xzf "$backup_path" -C "$SOURCE_CONFIG"

    log_success "Config restored from: $backup_path"
}

# List sync targets
list_targets() {
    log_info "OpenCode Ecosystem Sync Targets"
    echo

    # Mac
    echo "Mac (local):"
    if docker ps --format '{{.Names}}' | grep -q "bottown-daemon"; then
        log_success "  ✓ Daemon container running"
    else
        log_warn "  ✗ Daemon container not running"
    fi
    echo "  Config: $SOURCE_CONFIG"
    echo "  Skills: $SOURCE_SKILLS"
    echo

    # Dell
    echo "Dell LXC:"
    if ssh -q "${DELL_HOST:-root@192.168.1.201}" exit 2>/dev/null; then
        log_success "  ✓ SSH accessible"
    else
        log_warn "  ✗ SSH not accessible"
    fi
    echo "  Host: ${DELL_HOST:-root@192.168.1.201}"
    echo

    # Fly
    echo "Fly.io:"
    if fly apps list 2>/dev/null | grep -q "${FLY_APP:-bottown-worker}"; then
        log_success "  ✓ App exists"
    else
        log_warn "  ✗ App not found"
    fi
    echo "  App: ${FLY_APP:-bottown-worker}"
    echo

    # Source checksums
    log_info "Source Checksums:"
    echo "  Config: $(get_checksum "$SOURCE_CONFIG")"
    echo "  Skills: $(get_checksum "$SOURCE_SKILLS")"
}

# Main function
main() {
    if [[ $# -eq 0 ]]; then
        usage
        exit 1
    fi

    local COMMAND="$1"
    shift

    local DRY_RUN=""
    local FORCE=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            -n|--dry-run)
                DRY_RUN="true"
                shift
                ;;
            -f|--force)
                FORCE="true"
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

    case "$COMMAND" in
        sync-mac)
            check_source
            sync_mac "$DRY_RUN"
            ;;
        sync-dell)
            check_source
            sync_dell "$DRY_RUN"
            ;;
        sync-fly)
            check_source
            sync_fly "$DRY_RUN"
            ;;
        sync-all)
            check_source
            sync_mac "$DRY_RUN" || true
            sync_dell "$DRY_RUN" || true
            sync_fly "$DRY_RUN" || true
            log_success "Sync to all targets complete"
            ;;
        backup)
            backup_config
            ;;
        restore)
            restore_config "${1:-}"
            ;;
        list)
            list_targets
            ;;
        *)
            log_error "Unknown command: $COMMAND"
            usage
            exit 1
            ;;
    esac
}

main "$@"
