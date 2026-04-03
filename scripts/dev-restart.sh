#!/bin/bash
# Clean restart of the compass-v2 dev server.
# Stops launchd service, clears .next cache, restarts.
set -e

LABEL="com.openclaw.compass-v2-dev"
PROJECT_DIR="/Users/john/.openclaw/workspace/compass-v2"

echo "⏹  Stopping dev server..."
launchctl stop "$LABEL" 2>/dev/null || true
sleep 1

# Kill any stragglers
lsof -t -i :3002 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1

echo "🗑  Clearing .next cache..."
rm -rf "$PROJECT_DIR/.next"

echo "▶️  Starting dev server..."
launchctl start "$LABEL"

# Wait for ready
echo -n "⏳ Waiting for server..."
for i in $(seq 1 20); do
  if lsof -i :3002 -sTCP:LISTEN >/dev/null 2>&1; then
    PID=$(lsof -t -i :3002 -sTCP:LISTEN)
    START=$(ps -o lstart= -p "$PID" 2>/dev/null)
    echo ""
    echo "✅ Dev server running (PID $PID, started $START)"
    echo "   http://localhost:3002"
    exit 0
  fi
  echo -n "."
  sleep 1
done

echo ""
echo "❌ Server didn't start in 20s. Check /tmp/compass-v2-dev-error.log"
exit 1
