#!/usr/bin/env bash
# ==============================================================================
# MASHUPKGRID ISP — 1-Click Production Deploy & Safe Rebuild Script
# Location: /opt/mashuphost (Azure Ubuntu VM)
# Usage: bash infrastructure/scripts/deploy-prod.sh
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
  echo -e "${CYAN}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# Determine script root
TARGET_DIR="${1:-/opt/mashuphost}"

if [ -d "$TARGET_DIR" ]; then
  cd "$TARGET_DIR"
  log_info "Deploying in target directory: $TARGET_DIR"
else
  log_info "Deploying in current directory: $(pwd)"
fi

# 1. Check Git
if [ ! -d ".git" ]; then
  log_error "Not a git repository. Please run inside /opt/mashuphost."
  exit 1
fi

# 2. Check production environment file
if [ ! -f ".env.production" ]; then
  log_error ".env.production file is missing! Aborting deploy to prevent downtime."
  exit 1
fi

# Which branch to run. The GitHub deploy workflow passes the branch that was pushed; by hand it
# defaults to main.
BRANCH="${DEPLOY_BRANCH:-main}"
log_info "1/5 Fetching latest commits from GitHub origin/${BRANCH}..."
git fetch origin "$BRANCH"
LOCAL_HASH=$(git rev-parse HEAD)
REMOTE_HASH=$(git rev-parse "origin/${BRANCH}")

if [ "$LOCAL_HASH" != "$REMOTE_HASH" ] || [ "$(git rev-parse --abbrev-ref HEAD)" != "$BRANCH" ]; then
  log_info "Updating to ${BRANCH} @ ${REMOTE_HASH} (was ${LOCAL_HASH})..."
  # Tracked files only: .env.production and the data folders are untracked and left alone.
  git checkout -B "$BRANCH" "origin/${BRANCH}"
else
  log_info "Git is already up to date ($LOCAL_HASH)."
fi

# 3. Docker Compose Rebuild & Up
log_info "2/5 Rebuilding and updating production Docker containers (web, api, worker)..."
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# 4. Safe Disk Cleanup
log_info "3/5 Pruning dangling images to preserve VM disk space..."
docker image prune -f || true

# 5. Check Container Status
log_info "4/5 Checking running container health..."
docker compose -f docker-compose.prod.yml --env-file .env.production ps

# 6. Tail summary logs
log_info "5/5 Service logs check:"
echo "--- Web Container Logs (last 10 lines) ---"
docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail 10 web || true

echo "--- API Container Logs (last 10 lines) ---"
docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail 10 api || true

log_success "Deployment completed successfully! Live at https://mashuphost.tech"
