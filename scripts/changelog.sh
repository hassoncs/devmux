#!/bin/bash
set -e

# =============================================================================
# CHANGELOG GENERATION SCRIPT
# Generates changelog from Git history using Conventional Commits
# Usage: ./scripts/changelog.sh [version] [prev_version]
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; }
info() { echo -e "${BLUE}ℹ${NC} $1"; }

# =============================================================================
# Helper Functions
# =============================================================================

# Get the latest git tag
get_latest_tag() {
    git describe --tags --abbrev=0 2>/dev/null || echo ""
}

# Get previous tag (before specified tag)
get_prev_tag() {
    local tag="$1"
    git describe --tags --abbrev=0 "${tag}^{commit}" 2>/dev/null || echo ""
}

# Parse version from tag
parse_version() {
    echo "$1" | cut -d'v' -f2
}

# =============================================================================
# Main Logic
# =============================================================================

main() {
    local version="${1:-}"
    local prev_version="${2:-}"
    
    echo ""
    echo "=============================================="
    echo "  CHANGELOG GENERATOR"
    echo "=============================================="
    echo ""
    
    # If no version provided, suggest bump from latest
    if [ -z "$version" ]; then
        local latest_tag=$(get_latest_tag)
        if [ -n "$latest_tag" ]; then
            local current_version=$(parse_version "$latest_tag")
            info "Latest release: v$current_version"
            info "Suggesting patch bump. Run with version argument to override."
            version=$(semver inc patch "$current_version" 2>/dev/null || echo "$current_version")
        else
            version="1.0.0"
            info "No previous releases found, using $version"
        fi
    fi
    
    info "Generating changelog for: v$version"
    
    # Get previous version
    if [ -z "$prev_version" ]; then
        prev_version=$(get_prev_tag "v$version")
        if [ -z "$prev_version" ]; then
            prev_version=$(get_latest_tag)
        fi
        prev_version=$(parse_version "$prev_version")
    fi
    
    info "Comparing: v$prev_version → v$version"
    echo ""
    
    # Get commits between versions
    local range="${prev_version}..${version}"
    if [ "$prev_version" = "$version" ] || [ -z "$prev_version" ]; then
        # Get last 50 commits if no version range
        local commits=$(git log --oneline -50 2>/dev/null || echo "")
    else
        local commits=$(git log --no-merges --oneline "v${prev_version}..v${version}" 2>/dev/null || echo "")
    fi
    
    if [ -z "$commits" ]; then
        warn "No commits found in range"
        commits=$(git log --oneline -20 2>/dev/null || echo "")
    fi
    
    # Categorize commits
    local features=$(echo "$commits" | grep -iE "feat|feature" | sed 's/^[a-f0-9]* //' || echo "")
    local fixes=$(echo "$commits" | grep -iE "^fix" | sed 's/^[a-f0-9]* //' || echo "")
    local docs=$(echo "$commits" | grep -iE "docs" | sed 's/^[a-f0-9]* //' || echo "")
    local refactors=$(echo "$commits" | grep -iE "refactor" | sed 's/^[a-f0-9]* //' || echo "")
    local tests=$(echo "$commits" | grep -iE "test" | sed 's/^[a-f0-9]* //' || echo "")
    local chores=$(echo "$commits" | grep -iE "chore" | sed 's/^[a-f0-9]* //' || echo "")
    local styles=$(echo "$commits" | grep -iE "style" | sed 's/^[a-f0-9]* //' || echo "")
    local builds=$(echo "$commits" | grep -iE "build|ci" | sed 's/^[a-f0-9]* //' || echo "")
    
    # Get date
    local date=$(date +%Y-%m-%d)
    
    # Generate changelog content
    local changelog_content=""
    
    changelog_content+="## [$version] - $date\n"
    changelog_content+="\n"
    
    # Added
    if [ -n "$features" ]; then
        changelog_content+="### Added\n"
        echo "$features" | while IFS= read -r line; do
            if [ -n "$line" ]; then
                # Clean up commit message format
                line=$(echo "$line" | sed 's/([^)]*)//g' | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')
                changelog_content+="- $line\n"
            fi
        done
        changelog_content+="\n"
    fi
    
    # Fixed
    if [ -n "$fixes" ]; then
        changelog_content+="### Fixed\n"
        echo "$fixes" | while IFS= read -r line; do
            if [ -n "$line" ]; then
                line=$(echo "$line" | sed 's/([^)]*)//g' | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')
                changelog_content+="- $line\n"
            fi
        done
        changelog_content+="\n"
    fi
    
    # Changed
    if [ -n "$refactors" ] || [ -n "$builds" ]; then
        changelog_content+="### Changed\n"
        for line in $refactors $builds; do
            line=$(echo "$line" | sed 's/([^)]*)//g' | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')
            changelog_content+="- $line\n"
        done
        changelog_content+="\n"
    fi
    
    # Documentation
    if [ -n "$docs" ]; then
        changelog_content+="### Documentation\n"
        echo "$docs" | while IFS= read -r line; do
            if [ -n "$line" ]; then
                line=$(echo "$line" | sed 's/([^)]*)//g' | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')
                changelog_content+="- $line\n"
            fi
        done
        changelog_content+="\n"
    fi
    
    # Tests
    if [ -n "$tests" ]; then
        changelog_content+="### Tests\n"
        echo "$tests" | while IFS= read -r line; do
            if [ -n "$line" ]; then
                line=$(echo "$line" | sed 's/([^)]*)//g' | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')
                changelog_content+="- $line\n"
            fi
        done
        changelog_content+="\n"
    fi
    
    # Chores
    if [ -n "$chores" ] || [ -n "$styles" ]; then
        changelog_content+="### Internal\n"
        for line in $chores $styles; do
            line=$(echo "$line" | sed 's/([^)]*)//g' | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')
            changelog_content+="- $line\n"
        done
        changelog_content+="\n"
    fi
    
    # Get repo info for comparison links
    local repo_url=$(git remote get-url origin 2>/dev/null | sed 's/\.git$//' | sed 's/git@github.com:/https:\/\/github.com\//' || echo "")
    if [ -n "$repo_url" ]; then
        changelog_content+="[Unreleased]: $repo_url/compare/v${version}...main\n"
        changelog_content+="[$version]: $repo_url/releases/tag/v${version}\n"
    fi
    
    # Output to file
    local changelog_file="$ROOT_DIR/CHANGELOG.md"
    
    if [ -f "$changelog_file" ]; then
        # Get the header from existing changelog (first 5 lines usually contain attribution)
        local header=$(head -n 5 "$changelog_file")
        
        # Write new changelog
        {
            echo "$header"
            echo ""
            echo "# Changelog"
            echo ""
            echo "All notable changes to this project will be documented in this file."
            echo ""
            echo "The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),"
            echo "and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)."
            echo ""
            echo ""
            echo -e "$changelog_content"
            echo ""
            # Append existing content (skip the header we already included)
            tail -n +6 "$changelog_file"
        } > "$changelog_file.tmp"
        mv "$changelog_file.tmp" "$changelog_file"
    else
        {
            echo "# Changelog"
            echo ""
            echo "All notable changes to this project will be documented in this file."
            echo ""
            echo "The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),"
            echo "and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)."
            echo ""
            echo ""
            echo -e "$changelog_content"
        } > "$changelog_file"
    fi
    
    log "Changelog updated: $changelog_file"
    echo ""
    info "Summary:"
    [ -n "$features" ] && info "  • $(echo "$features" | wc -l) features"
    [ -n "$fixes" ] && info "  • $(echo "$fixes" | wc -l) fixes"
    [ -n "$docs" ] && info "  • $(echo "$docs" | wc -l) documentation changes"
    echo ""
    info "Next steps:"
    info "  1. Review CHANGELOG.md for accuracy"
    info "  2. Add any manual notes for major changes"
    info "  3. Commit: git add CHANGELOG.md && git commit -m \"docs(changelog): update for v$version\""
    info "  4. Or run: ./scripts/release.sh --version $version"
}

main "$@"
