#!/bin/bash
set -e

# =============================================================================
# GENERIC RELEASE SCRIPT
# Works with any pnpm monorepo following the standard convention
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; }
info() { echo -e "${BLUE}ℹ${NC} $1"; }
section() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}\n"; }

# =============================================================================
# Configuration
# =============================================================================

RELEASE_VERSION=""
SKIP_TESTS=0
SKIP_DEPLOY=0
DRY_RUN=0
OTP=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --version)
            RELEASE_VERSION="$2"
            shift 2
            ;;
        --skip-tests)
            SKIP_TESTS=1
            shift
            ;;
        --skip-deploy)
            SKIP_DEPLOY=1
            shift
            ;;
        --dry-run)
            DRY_RUN=1
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --version X.Y.Z   Specify release version"
            echo "  --skip-tests      Skip running tests"
            echo "  --skip-deploy     Skip deployment"
            echo "  --dry-run         Preview without making changes"
            echo "  --help, -h        Show this help"
            exit 0
            ;;
        *)
            error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# =============================================================================
# Helper Functions
# =============================================================================

get_repo_name() {
    node -p "require('$ROOT_DIR/package.json').name" 2>/dev/null | sed 's/-monorepo$//' || basename "$ROOT_DIR"
}

get_version() {
    local pkg="$1"
    node -p "require('$pkg/package.json').version" 2>/dev/null || echo ""
}

get_latest_tag() {
    git describe --tags --abbrev=0 2>/dev/null | cut -d'v' -f2 || echo ""
}

semver_bump() {
    local type="$1"
    local version="$2"
    
    # Simple semver bump without external dependencies
    IFS='.' read -r major minor patch <<< "$version"
    
    case "$type" in
        major) ((major++)); minor=0; patch=0 ;;
        minor) ((minor++)); patch=0 ;;
        patch) ((patch++)) ;;
    esac
    
    echo "$major.$minor.$patch"
}

# =============================================================================
# Step 1: Load Configuration
# =============================================================================

load_config() {
    section "Loading Configuration"
    
    REPO_NAME=$(get_repo_name)
    info "Repository: $REPO_NAME"
    
    # Get workspaces
    WORKSPACES=$(node -p "require('$ROOT_DIR/package.json').workspaces" 2>/dev/null || echo "[]")
    if [ "$WORKSPACES" = "[]" ] && [ -f "$ROOT_DIR/pnpm-workspace.yaml" ]; then
        WORKSPACES=$(node -p "require('$ROOT_DIR/pnpm-workspace.yaml').packages" 2>/dev/null || echo "['packages/*']")
    fi
    
    log "Configuration loaded"
}

# =============================================================================
# Step 2: Discover Deployable Packages
# =============================================================================

discover_packages() {
    section "Discovering Deployable Packages"
    
    DEPLOYABLE_PACKAGES=()
    
    # Find all workspace packages
    if [ -f "$ROOT_DIR/pnpm-workspace.yaml" ]; then
        # Parse pnpm-workspace.yaml
        local patterns=$(node -e "
            const yaml = require('yaml');
            const fs = require('fs');
            const doc = yaml.parse(fs.readFileSync('$ROOT_DIR/pnpm-workspace.yaml', 'utf8'));
            console.log(JSON.stringify(doc.packages || ['packages/*']));
        " 2>/dev/null || echo "['packages/*']")
        
        patterns=$(echo "$patterns" | node -e "const d=require('fs').readFileSync(0,'utf8');console.log(JSON.parse(d).join(' '))" 2>/dev/null || echo "packages/*")
        
        for pattern in $patterns; do
            for pkg_dir in $(find "$ROOT_DIR" -type d -path "*/$pattern" -maxdepth 3 2>/dev/null); do
                if [ -f "$pkg_dir/package.json" ]; then
                    PKG_NAME=$(node -p "require('$pkg_dir/package.json').name" 2>/dev/null || echo "")
                    PKG_VERSION=$(node -p "require('$pkg_dir/package.json').version" 2>/dev/null || echo "")
                    
                    if [ -n "$PKG_NAME" ] && [ "$PKG_NAME" != "undefined" ]; then
                        # Determine deploy type
                        DEPLOY_TYPE=""
                        
                        if node -p "require('$pkg_dir/package.json').bin" 2>/dev/null | grep -q .; then
                            DEPLOY_TYPE="npm"
                        elif [ -f "$pkg_dir/wrangler.toml" ]; then
                            DEPLOY_TYPE="wrangler"
                        elif node -p "require('$pkg_dir/package.json').scripts.deploy" 2>/dev/null | grep -q .; then
                            DEPLOY_TYPE="script"
                        elif node -p "require('$pkg_dir/package.json').scripts.pages:deploy" 2>/dev/null | grep -q .; then
                            DEPLOY_TYPE="pages"
                        fi
                        
                        if [ -n "$DEPLOY_TYPE" ]; then
                            DEPLOYABLE_PACKAGES+=("$PKG_NAME|$PKG_VERSION|$pkg_dir|$DEPLOY_TYPE")
                            info "  Found: $PKG_NAME@$PKG_VERSION ($DEPLOY_TYPE)"
                        fi
                    fi
                fi
            done
        done
    fi
    
    if [ ${#DEPLOYABLE_PACKAGES[@]} -eq 0 ]; then
        warn "No deployable packages found"
    else
        log "Found ${#DEPLOYABLE_PACKAGES[@]} deployable package(s)"
    fi
}

# =============================================================================
# Step 3: Determine Release Version
# =============================================================================

get_release_version() {
    section "Release Version"
    
    if [ -n "$RELEASE_VERSION" ]; then
        log "Using provided version: $RELEASE_VERSION"
        return
    fi
    
    local latest=$(get_latest_tag)
    if [ -n "$latest" ]; then
        info "Current version: $latest"
        info "Suggest a version bump:"
        echo ""
        echo "  [p]atch → $(semver_bump patch $latest)"
        echo "  [m]inor → $(semver_bump minor $latest)"
        echo "  [M]ajor → $(semver_bump major $latest)"
        echo "  [c]ustom"
        echo ""
        read -p "Version [$((echo "$latest" | cut -d. -f1).$((echo "$latest" | cut -d. -f2).$((echo "$latest" | cut -d. -f3 + 1))]: " choice
        
        case "$choice" in
            p|P) RELEASE_VERSION=$(semver_bump patch $latest) ;;
            m|M) RELEASE_VERSION=$(semver_bump minor $latest) ;;
            c|C)
                read -p "Enter version: " RELEASE_VERSION
                ;;
            "")
                RELEASE_VERSION=$(semver_bump patch $latest)
                ;;
            *)
                RELEASE_VERSION=$choice
                ;;
        esac
    else
        RELEASE_VERSION="1.0.0"
        info "No previous releases, using $RELEASE_VERSION"
    fi
    
    log "Release version: $RELEASE_VERSION"
}

# =============================================================================
# Step 4: Build All Packages
# =============================================================================

build_packages() {
    section "Building Packages"
    
    log "Building all packages..."
    if pnpm -r run build 2>&1; then
        log "All packages built successfully"
    else
        error "Build failed"
        exit 1
    fi
}

# =============================================================================
# Step 5: Run Tests
# =============================================================================

run_tests() {
    section "Running Tests"
    
    if [ $SKIP_TESTS -eq 1 ]; then
        warn "Skipping tests (--skip-tests)"
        return
    fi
    
    log "Running all tests..."
    if pnpm -r run test 2>&1; then
        log "All tests passed"
    else
        error "Tests failed"
        exit 1
    fi
}

# =============================================================================
# Step 6: Generate Changelog
# =============================================================================

update_changelog() {
    section "Updating Changelog"
    
    if [ -f "$SCRIPT_DIR/changelog.sh" ]; then
        log "Generating changelog..."
        bash "$SCRIPT_DIR/changelog.sh" "$RELEASE_VERSION"
        log "Changelog updated"
    else
        warn "changelog.sh not found, skipping"
    fi
}

# =============================================================================
# Step 7: Commit Changes
# =============================================================================

commit_release() {
    section "Committing Release"
    
    log "Committing version bump and changelog..."
    git add -A
    git commit -m "chore(release): $RELEASE_VERSION"
    git tag "v$RELEASE_VERSION"
    
    log "Committed and tagged v$RELEASE_VERSION"
}

# =============================================================================
# Step 8: Deploy Packages
# =============================================================================

deploy_packages() {
    section "Deploying Packages"
    
    if [ $SKIP_DEPLOY -eq 1 ]; then
        warn "Skipping deployment (--skip-deploy)"
        return
    fi
    
    if [ ${#DEPLOYABLE_PACKAGES[@]} -eq 0 ]; then
        warn "No packages to deploy"
        return
    fi
    
    # Get npm OTP
    read -p "🔑 Enter npm OTP: " OTP
    echo ""
    
    if [ -z "$OTP" ]; then
        error "OTP required for npm publish"
        exit 1
    fi
    
    log "Deploying packages in parallel..."
    echo ""
    
    declare -A PIDS
    
    # Deploy each package
    for pkg_info in "${DEPLOYABLE_PACKAGES[@]}"; do
        IFS='|' read -r PKG_NAME PKG_VERSION PKG_PATH DEPLOY_TYPE <<< "$pkg_info"
        
        (
            case "$DEPLOY_TYPE" in
                npm)
                    cd "$PKG_PATH"
                    echo "[$PKG_NAME] Publishing to npm..."
                    if npm publish --otp="$OTP" 2>&1; then
                        echo "[$PKG_NAME] ✓ Published $PKG_NAME@$RELEASE_VERSION"
                    else
                        echo "[$PKG_NAME] ✗ Publish failed"
                        exit 1
                    fi
                    ;;
                wrangler|script|pages)
                    cd "$PKG_PATH"
                    if [ -f "package.json" ] && node -p "require('./package.json').scripts.deploy" &>/dev/null; then
                        echo "[$PKG_NAME] Running deploy..."
                        if pnpm deploy 2>&1; then
                            echo "[$PKG_NAME] ✓ Deployed"
                        else
                            echo "[$PKG_NAME] ✗ Deploy failed"
                            exit 1
                        fi
                    fi
                    ;;
            esac
        ) &
        PIDS["$PKG_NAME"]=$!
    done
    
    # Wait for all deployments
    FAILED=0
    for pkg_info in "${DEPLOYABLE_PACKAGES[@]}"; do
        IFS='|' read -r PKG_NAME PKG_VERSION PKG_PATH DEPLOY_TYPE <<< "$pkg_info"
        wait ${PIDS[$PKG_NAME]} || FAILED=1
    done
    
    if [ $FAILED -eq 0 ]; then
        log "All packages deployed successfully"
    else
        error "Some deployments failed"
        exit 1
    fi
}

# =============================================================================
# Step 9: Push to Remote
# =============================================================================

push_release() {
    section "Pushing to Remote"
    
    log "Pushing to remote..."
    git push origin main 2>/dev/null || git push origin master 2>/dev/null
    git push origin "v$RELEASE_VERSION"
    
    log "Pushed to remote"
}

# =============================================================================
# Main Execution
# =============================================================================

main() {
    echo ""
    echo "=============================================="
    echo "  $REPO_NAME Release Script"
    echo "  Version: ${RELEASE_VERSION:-<interactive>}"
    echo "=============================================="
    echo ""
    
    if [ $DRY_RUN -eq 1 ]; then
        warn "DRY RUN - No changes will be made"
        echo ""
    fi
    
    # Execute release steps
    load_config
    discover_packages
    get_release_version
    
    if [ $DRY_RUN -eq 0 ]; then
        build_packages
        run_tests
        update_changelog
        commit_release
        deploy_packages
        push_release
        
        echo ""
        echo "=============================================="
        echo "  🎉 RELEASE COMPLETE: v$RELEASE_VERSION"
        echo "=============================================="
        echo ""
        info "Next steps:"
        info "  • Create GitHub release from tag v$RELEASE_VERSION"
        info "  • Update documentation if needed"
    else
        echo ""
        echo "DRY RUN SUMMARY:"
        echo "  Version: $RELEASE_VERSION"
        echo "  Packages: ${#DEPLOYABLE_PACKAGES[@]}"
        echo "  Skip tests: $SKIP_TESTS"
        echo "  Skip deploy: $SKIP_DEPLOY"
    fi
}

main
