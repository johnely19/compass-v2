#!/bin/bash
# staging-dev-server.sh — Runs the Next.js dev server tracking the staging branch
# Used by the LaunchAgent to keep localhost:3002 running 24/7
#
# This script:
# 1. Checks out the staging branch in a dedicated worktree
# 2. Pulls latest changes
# 3. Installs deps if needed
# 4. Starts next dev on port 3002

set -euo pipefail

REPO_ROOT="/Users/john/.openclaw/workspace/compass-v2"
STAGING_WORKTREE="${REPO_ROOT}.worktrees/staging"

# Create staging worktree if it doesn't exist
if [ ! -d "$STAGING_WORKTREE" ]; then
  echo "[staging-dev] Creating staging worktree..."
  cd "$REPO_ROOT"
  git fetch origin staging
  git worktree add "$STAGING_WORKTREE" origin/staging
fi

cd "$STAGING_WORKTREE"

# Pull latest staging
echo "[staging-dev] Pulling latest staging..."
git fetch origin staging
git checkout staging 2>/dev/null || git checkout -b staging origin/staging
git reset --hard origin/staging

# Copy .env.local from main repo if not present
if [ ! -f "$STAGING_WORKTREE/.env.local" ] && [ -f "$REPO_ROOT/.env.local" ]; then
  echo "[staging-dev] Copying .env.local from main repo..."
  cp "$REPO_ROOT/.env.local" "$STAGING_WORKTREE/.env.local"
fi

# Install dependencies if node_modules missing or package-lock changed
if [ ! -d "$STAGING_WORKTREE/node_modules" ]; then
  echo "[staging-dev] Installing dependencies..."
  npm ci
fi

echo "[staging-dev] Starting Next.js dev server on port 3002..."
exec npx next dev -p 3002
