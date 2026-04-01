# Staging Branch Workflow

## Overview

PRs merge to `staging` (not `main`), get tested on localhost:3002, then batch-deploy to production via `staging → main` merge.

## Architecture

```
Feature PRs → staging branch → localhost:3002 (test) → main branch → Vercel (prod)
```

- **`staging`** — development integration branch, all PRs target this
- **`main`** — production branch, only updated via intentional staging→main merges
- **localhost:3002** — local Next.js dev server tracking staging, runs 24/7 on Mac mini

## How It Works

### For DevClaw workers
Workers automatically create PRs targeting `staging` (configured in DevClaw projects.json). No code changes needed — the `baseBranch` config handles this.

### For manual development
When creating PRs manually, target `staging` instead of `main`.

### Testing changes
1. Changes merged to staging auto-update on localhost:3002 (pulled every 2 minutes)
2. Test at http://localhost:3002
3. Visual QA, smoke tests, manual checks

### Deploying to production
When a batch of changes is ready:
```bash
cd /Users/john/.openclaw/workspace/compass-v2
git checkout main
git merge staging
git push origin main
# This triggers a single Vercel deploy
```

## Local Dev Server

### Setup
```bash
bash scripts/setup-staging.sh
```

### Components
- **staging-dev-server.sh** — Starts `next dev -p 3002` in the staging worktree
- **staging-pull.sh** — Pulls latest staging every 2 minutes, reinstalls deps if needed
- **LaunchAgents** — Keep both scripts running 24/7

### Management
```bash
# Check status
launchctl list | grep compass-staging

# View logs
tail -f logs/staging-dev.log
tail -f logs/staging-pull.log

# Restart dev server
launchctl kickstart -k gui/$(id -u)/com.openclaw.compass-staging-dev

# Stop everything
launchctl unload ~/Library/LaunchAgents/com.openclaw.compass-staging-dev.plist
launchctl unload ~/Library/LaunchAgents/com.openclaw.compass-staging-pull.plist
```

## File Locations

| File | Purpose |
|------|---------|
| `scripts/staging-dev-server.sh` | Dev server launcher |
| `scripts/staging-pull.sh` | Auto-pull staging changes |
| `scripts/setup-staging.sh` | One-time setup script |
| `scripts/com.openclaw.compass-staging-dev.plist` | LaunchAgent for dev server |
| `scripts/com.openclaw.compass-staging-pull.plist` | LaunchAgent for auto-pull |
| `logs/staging-dev.log` | Dev server output |
| `logs/staging-pull.log` | Pull script output |
