#!/usr/bin/env bash
# Ubuntu / Linux: one-shot deploy for crypto-gateway monorepo.
# Usage (from anywhere):
#   bash scripts/deploy.sh
# Or:
#   chmod +x scripts/deploy.sh && ./scripts/deploy.sh
#
# Prerequisites on the server:
#   - Node.js >= 20, npm
#   - PostgreSQL reachable via DATABASE_URL in .env
#   - Optional: PM2 globally (`npm i -g pm2`) for API + cron (deposit scanner)
#
# Env (optional):
#   DEPLOY_GIT_PULL=1     — run `git pull --ff-only` before install (repo must be a git clone)
#   DEPLOY_SKIP_PM2=1     — only install + prisma + build; do not touch PM2
#   DEPLOY_SKIP_INSTALL=1 — skip `npm ci` (faster re-deploy if deps unchanged)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() {
  printf "\n\033[1;36m==>\033[0m %s\n" "$*"
}

die() {
  printf "\n\033[1;31mERROR:\033[0m %s\n" "$*" >&2
  exit 1
}

if [[ ! -f "$ROOT/.env" ]] && [[ ! -f "$ROOT/server/.env" ]]; then
  die "Missing .env — create $ROOT/.env (or server/.env) with DATABASE_URL, JWT_SECRET, MNEMONIC, RPC_*, etc."
fi

if [[ "${DEPLOY_GIT_PULL:-0}" == "1" ]]; then
  if [[ -d "$ROOT/.git" ]]; then
    log "Git pull (DEPLOY_GIT_PULL=1)"
    git pull --ff-only
  else
    die "DEPLOY_GIT_PULL=1 but $ROOT is not a git clone (.git missing)"
  fi
fi

if [[ "${DEPLOY_SKIP_INSTALL:-0}" != "1" ]]; then
  log "Installing dependencies (npm ci — NODE_ENV=development so Prisma CLI devDep is installed)"
  NODE_ENV=development npm ci --no-audit --no-fund
else
  log "Skipping npm ci (DEPLOY_SKIP_INSTALL=1)"
fi

export NODE_ENV="${NODE_ENV:-production}"

log "Prisma generate"
npm run prisma:generate

log "Prisma migrate deploy"
npm run prisma:deploy

log "Production build (server check + client Vite → client/dist)"
npm run build

if [[ "${DEPLOY_SKIP_PM2:-0}" == "1" ]]; then
  log "Skipping PM2 (DEPLOY_SKIP_PM2=1). Start manually: cd $ROOT && npm run pm2:start"
  exit 0
fi

if ! command -v pm2 >/dev/null 2>&1; then
  log "PM2 not found — skipping process manager. Install: sudo npm i -g pm2"
  log "Run API manually:  cd $ROOT/server && NODE_ENV=production node src/index.js"
  log "Run cron+scanner: cd $ROOT/cron && NODE_ENV=production node src/index.js"
  exit 0
fi

log "PM2 reload or start (ecosystem.config.cjs)"
if pm2 describe crypto-gateway-api >/dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --update-env
else
  pm2 start ecosystem.config.cjs
fi

pm2 save 2>/dev/null || true

log "Done. Check: pm2 status (crypto-gateway-api + crypto-gateway-cron online) && pm2 logs crypto-gateway-api --lines 50"
