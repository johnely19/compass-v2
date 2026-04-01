#!/bin/bash
# setup-staging.sh — One-time setup for the staging workflow
# Creates the staging worktree, installs LaunchAgents, and starts everything
#
# Usage: bash scripts/setup-staging.sh

set -euo pipefail

REPO_ROOT="/Users/john/.openclaw/workspace/compass-v2"
STAGING_WORKTREE="${REPO_ROOT}.worktrees/staging"
SCRIPTS_DIR="$REPO_ROOT/scripts"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$REPO_ROOT/logs"

echo "=== Compass V2 Staging Workflow Setup ==="

# 1. Create logs directory
mkdir -p "$LOG_DIR"
echo "✓ Created logs directory"

# 2. Create staging worktree
if [ ! -d "$STAGING_WORKTREE" ]; then
  cd "$REPO_ROOT"
  git fetch origin staging
  git worktree add "$STAGING_WORKTREE" origin/staging
  echo "✓ Created staging worktree at $STAGING_WORKTREE"
else
  echo "✓ Staging worktree already exists"
fi

# 3. Copy .env.local
if [ ! -f "$STAGING_WORKTREE/.env.local" ] && [ -f "$REPO_ROOT/.env.local" ]; then
  cp "$REPO_ROOT/.env.local" "$STAGING_WORKTREE/.env.local"
  echo "✓ Copied .env.local to staging worktree"
fi

# 4. Install dependencies in staging worktree
cd "$STAGING_WORKTREE"
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies in staging worktree..."
  npm ci
  echo "✓ Dependencies installed"
else
  echo "✓ Dependencies already installed"
fi

# 5. Install LaunchAgents
mkdir -p "$LAUNCH_AGENTS_DIR"

# Unload existing agents if present
launchctl unload "$LAUNCH_AGENTS_DIR/com.openclaw.compass-staging-dev.plist" 2>/dev/null || true
launchctl unload "$LAUNCH_AGENTS_DIR/com.openclaw.compass-staging-pull.plist" 2>/dev/null || true

# Copy and load new agents
cp "$SCRIPTS_DIR/com.openclaw.compass-staging-dev.plist" "$LAUNCH_AGENTS_DIR/"
cp "$SCRIPTS_DIR/com.openclaw.compass-staging-pull.plist" "$LAUNCH_AGENTS_DIR/"

launchctl load "$LAUNCH_AGENTS_DIR/com.openclaw.compass-staging-dev.plist"
launchctl load "$LAUNCH_AGENTS_DIR/com.openclaw.compass-staging-pull.plist"

echo "✓ LaunchAgents installed and loaded"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "  Dev server:  http://localhost:3002"
echo "  Logs:        $LOG_DIR/staging-dev.log"
echo "  Pull logs:   $LOG_DIR/staging-pull.log"
echo ""
echo "  Auto-pull runs every 2 minutes."
echo "  Dev server restarts automatically if it crashes."
echo ""
echo "  To check status:"
echo "    launchctl list | grep compass-staging"
echo ""
echo "  To stop:"
echo "    launchctl unload ~/Library/LaunchAgents/com.openclaw.compass-staging-dev.plist"
echo "    launchctl unload ~/Library/LaunchAgents/com.openclaw.compass-staging-pull.plist"
echo ""
echo "  To deploy to production:"
echo "    cd $REPO_ROOT && git checkout main && git merge staging && git push origin main"
