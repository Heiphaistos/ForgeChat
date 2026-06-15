#!/bin/bash
# ForgeChat — Script de déploiement VPS
# Usage: ./deploy.sh [--ssl-only] [--skip-build]
set -euo pipefail

DOMAIN="forgechat.heiphaistos.org"
DEPLOY_DIR="/opt/forgechat"
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

log() { echo "[$(date '+%H:%M:%S')] $*"; }

# ── SSL (première fois) ─────────────────────────────────────────────
if [[ "${1:-}" == "--ssl-only" ]]; then
    log "Obtention du certificat SSL pour $DOMAIN..."
    certbot certonly --standalone \
        --non-interactive --agree-tos \
        --email admin@heiphaistos.org \
        -d "$DOMAIN"
    log "SSL OK → relancer sans --ssl-only"
    exit 0
fi

# ── Build client React ──────────────────────────────────────────────
if [[ "${1:-}" != "--skip-build" ]]; then
    log "Build du client React..."
    cd "$REPO_DIR/client"
    npm ci --silent
    npm run build
    cd "$REPO_DIR"
    log "Build OK → dist/ prêt"
fi

# ── Copier sur le VPS ──────────────────────────────────────────────
log "Déploiement dans $DEPLOY_DIR..."
mkdir -p "$DEPLOY_DIR"
rsync -a --delete \
    --exclude='client/node_modules' \
    --exclude='server/target' \
    --exclude='.env' \
    --exclude='.logs' \
    "$REPO_DIR/" "$DEPLOY_DIR/"

cd "$DEPLOY_DIR"

# Vérifier le .env
if [[ ! -f .env ]]; then
    log "ERREUR : .env manquant ! Copie .env.example → .env et remplis les secrets."
    exit 1
fi

# ── Docker Compose ──────────────────────────────────────────────────
log "Démarrage des services..."
docker compose pull --quiet 2>/dev/null || true
docker compose up -d --build --remove-orphans

log "Attente de la DB (max 30s)..."
for i in $(seq 1 30); do
    docker compose exec -T postgres pg_isready -U forgechat -q 2>/dev/null && break
    sleep 1
done

log "Vérification des services..."
docker compose ps

log ""
log "✅ ForgeChat déployé sur https://$DOMAIN"
log "   Logs serveur : docker compose logs -f server"
log "   Logs nginx   : docker compose logs -f nginx"
