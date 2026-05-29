#!/bin/bash
set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
MAIN_BRANCH="main"
REQUIRED_BRANCH="main"

# Helper functions
error() {
    echo -e "${RED}Error: $1${NC}" >&2
    exit 1
}

success() {
    echo -e "${GREEN}✓ $1${NC}"
}

info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

# Parse arguments
VERSION_TYPE="${1:-patch}"
if [[ ! "$VERSION_TYPE" =~ ^(patch|minor|major)$ ]]; then
    error "Invalid version type: $VERSION_TYPE. Must be 'patch', 'minor', or 'major'."
fi

info "Starting release process for version bump: $VERSION_TYPE"
echo ""

# Pre-flight checks
info "Running pre-flight checks..."

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    error "Not in a git repository"
fi

# Check if we're on the correct branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "$REQUIRED_BRANCH" ]; then
    error "Must be on '$REQUIRED_BRANCH' branch (currently on '$CURRENT_BRANCH')"
fi

# Check for uncommitted changes
# Refresh the index first so stale stat info (e.g. mtimes changed by a
# checkout/build/install while content is identical) doesn't cause a false
# positive. Without this, `git diff-index` can report changes even when
# `git status` shows a clean tree.
git update-index -q --refresh
if ! git diff-index --quiet HEAD --; then
    error "Working tree has uncommitted changes. Please commit or stash them first."
fi

# Check for unpushed commits
UNPUSHED=$(git log origin/$MAIN_BRANCH..$MAIN_BRANCH --oneline 2>/dev/null | wc -l)
if [ "$UNPUSHED" -gt 0 ]; then
    warning "You have $UNPUSHED unpushed commit(s) on $MAIN_BRANCH"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        error "Aborted by user"
    fi
fi

# Check if remote is reachable
if ! git ls-remote origin > /dev/null 2>&1; then
    error "Cannot reach remote 'origin'. Check your internet connection."
fi

# Fetch latest from remote
info "Fetching latest changes from remote..."
git fetch origin --tags

# Check if local branch is behind remote
LOCAL=$(git rev-parse @)
REMOTE=$(git rev-parse @{u})
if [ "$LOCAL" != "$REMOTE" ]; then
    error "Local branch is out of sync with remote. Please pull latest changes."
fi

success "All pre-flight checks passed"
echo ""

# Get current version for confirmation
CURRENT_VERSION=$(node -p "require('./package.json').version")
info "Current version: $CURRENT_VERSION"

# Calculate what the new version will be
case "$VERSION_TYPE" in
    patch)
        NEW_VERSION=$(echo "$CURRENT_VERSION" | awk -F. '{printf "%d.%d.%d", $1, $2, $3+1}')
        ;;
    minor)
        NEW_VERSION=$(echo "$CURRENT_VERSION" | awk -F. '{printf "%d.%d.0", $1, $2+1}')
        ;;
    major)
        NEW_VERSION=$(echo "$CURRENT_VERSION" | awk -F. '{printf "%d.0.0", $1+1}')
        ;;
esac
info "New version will be: $NEW_VERSION"
echo ""

# Confirm with user
warning "This will:"
echo "  1. Run tests (if available)"
echo "  2. Build the project"
echo "  3. Bump version to $NEW_VERSION"
echo "  4. Create git commit and tag v$NEW_VERSION"
echo "  5. Push to origin with tags (triggers release workflow)"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    error "Aborted by user"
fi
echo ""

# Store original state for potential rollback
ORIGINAL_COMMIT=$(git rev-parse HEAD)

# Rollback function
rollback() {
    warning "Rolling back changes..."
    git reset --hard "$ORIGINAL_COMMIT"
    git tag -d "v$NEW_VERSION" 2>/dev/null || true
    error "Release failed. Changes have been rolled back."
}

# Set trap for rollback on error
trap rollback ERR

# Run tests if test script exists
if grep -q '"test"' package.json 2>/dev/null; then
    info "Running tests..."
    bun test || npm test
    success "Tests passed"
    echo ""
fi

# Run typecheck
info "Running type check..."
bun run typecheck
success "Type check passed"
echo ""

# Build project
info "Building project..."
bun run build
success "Build successful"
echo ""

# Bump version (this creates a commit and tag automatically)
info "Bumping version to $NEW_VERSION..."
npm version "$VERSION_TYPE" -m "Release v%s"
success "Version bumped to $NEW_VERSION"
echo ""

# Push changes and tags
info "Pushing changes and tags to origin..."
git push origin "$MAIN_BRANCH" --follow-tags
success "Pushed to origin"
echo ""

# Remove error trap
trap - ERR

# Final success message
echo ""
success "Release initiated successfully!"
info "Version: v$NEW_VERSION"
info "Monitor the release workflow at: https://github.com/C41M50N/ai/actions"
echo ""
info "The GitHub Actions workflow will:"
echo "  • Build the package"
echo "  • Publish to npm (via OIDC trusted publishing)"
echo "  • Generate provenance attestations"
echo "  • Create a GitHub release"
echo ""