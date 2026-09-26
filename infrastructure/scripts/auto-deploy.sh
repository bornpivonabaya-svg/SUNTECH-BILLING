#!/usr/bin/env bash
# ==============================================================================
# MASHUPKGRID ISP — Automated GitHub Update Detector & Continuous Deployment
# Location: /opt/mashuphost/infrastructure/scripts/auto-deploy.sh
# Runs via cron or systemd timer to automatically detect GitHub commits and rebuild.
# ==============================================================================

set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

TARGET_DIR="${1:-/opt/mashuphost}"
LOCK_FILE="/tmp/mashuphost-autodeploy.lock"
LOG_FILE="${TARGET_DIR}/auto-deploy.log"

# Keep log size reasonable (truncate if > 10MB)
if [ -f "$LOG_FILE" ] && [ $(stat -c%s "$LOG_FILE" 2>/dev/null || stat -f%z "$LOG_FILE" 2>/dev/null || echo 0) -gt 10485760 ]; then
  tail -n 1000 "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"
fi

exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  # Another deployment or update check is currently running. Exit silently.
  exit 0
fi

cd "$TARGET_DIR"

if [ ! -d ".git" ] || [ ! -f ".env.production" ]; then
  exit 0
fi

# Fetch latest state from origin
git fetch origin main -q 2>/dev/null || exit 0

LOCAL_HASH=$(git rev-parse HEAD)
REMOTE_HASH=$(git rev-parse origin/main)

# Only build if remote has new commits
if [ "$LOCAL_HASH" != "$REMOTE_HASH" ]; then
  TIMESTAMP=$(date -u +'%Y-%m-%d %H:%M:%SZ')
  echo "================================================================================" >> "$LOG_FILE"
  echo "[$TIMESTAMP] [AUTO-DEPLOY] New update detected on GitHub origin/main!" >> "$LOG_FILE"
  echo "[$TIMESTAMP] Current: $LOCAL_HASH -> Remote: $REMOTE_HASH" >> "$LOG_FILE"
  
  # Pull latest code
  git pull origin main >> "$LOG_FILE" 2>&1
  
  # Execute production rebuild
  echo "[$TIMESTAMP] Running docker compose rebuild and migrations..." >> "$LOG_FILE"
  docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build >> "$LOG_FILE" 2>&1
  
  # Prune dangling builder cache and images to keep disk free
  docker builder prune -f >> "$LOG_FILE" 2>&1 || true
  docker image prune -f >> "$LOG_FILE" 2>&1 || true
  
  COMPLETE_TIME=$(date -u +'%Y-%m-%d %H:%M:%SZ')
  echo "[$COMPLETE_TIME] [AUTO-DEPLOY] Deployment complete! Stack is live." >> "$LOG_FILE"
  echo "================================================================================" >> "$LOG_FILE"
fi
