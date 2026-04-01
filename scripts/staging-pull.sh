#!/bin/bash
# staging-pull.sh — Pull latest staging branch into the staging worktree
# Run via cron every 2 minutes or triggered by DevClaw after PR merge
#
# If package-lock.json changed, re-installs deps and restarts the dev server

set -euo pipefail

REPO_ROOT="/Users/john/.openclaw/workspace/compass-v2"
STAGING_WORKTREE="${REPO_ROOT}.worktrees/staging"
LAUNCHAGENT_LABEL="com.openclaw.compass-staging-dev"

if [ ! -d "$STAGING_WORKTREE" ]; then
  echo "[staging-pull] Staging worktree not found at $STAGING_WORKTREE"
  exit 1
fi

cd "$STAGING_WORKTREE"

# Record current package-lock hash
OLD_LOCK_HASH=""
if [ -f package-lock.json ]; then
  OLD_LOCK_HASH=$(md5 -q package-lock.json 2>/dev/null || md5sum package-lock.json | cut -d' ' -f1)
fi

# Fetch and reset to latest staging
git fetch origin staging
CURRENT=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/staging)

if [ "$CURRENT" = "$REMOTE" ]; then
  echo "[staging-pull] Already up to date."
  exit 0
fi

echo "[staging-pull] Updating staging: $CURRENT -> $REMOTE"
git reset --hard origin/staging

# Check if deps changed
NEW_LOCK_HASH=""
if [ -f package-lock.json ]; then
  NEW_LOCK_HASH=$(md5 -q package-lock.json 2>/dev/null || md5sum package-lock.json | cut -d' ' -f1)
fi

if [ "$OLD_LOCK_HASH" != "$NEW_LOCK_HASH" ]; then
  echo "[staging-pull] package-lock.json changed, reinstalling deps..."
  npm ci
  
  # Restart the dev server if running via LaunchAgent
  echo "[staging-pull] Restarting dev server..."
  launchctl kickstart -k "gui/$(id -u)/$LAUNCHAGENT_LABEL" 2>/dev/null || true
else
  echo "[staging-pull] No dependency changes, Next.js will hot-reload."
fi

# Copy .env.local if missing
if [ ! -f "$STAGING_WORKTREE/.env.local" ] && [ -f "$REPO_ROOT/.env.local" ]; then
  cp "$REPO_ROOT/.env.local" "$STAGING_WORKTREE/.env.local"
fi

echo "[staging-pull] Done."
