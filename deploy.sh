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

# ── Healthcheck TURN (N7) ───────────────────────────────────────────
# Une panne TURN silencieuse a déjà coûté ~7 itérations : appels muets en NAT
# strict, visibles nulle part sauf dans /var/log/turnserver/turn_<pid>.log.
# Ici : si TURN est configuré il DOIT répondre, sinon on échoue bruyamment.
# Si TURN n'est volontairement pas configuré, on avertit sans bloquer.
turn_healthcheck() {
    # shellcheck disable=SC1091
    set +u
    TURN_URL="$(grep -E '^TURN_URL=' .env | cut -d= -f2- | sed 's/^["'\'']//; s/["'\'']$//' | xargs || true)"
    TURN_STATIC_AUTH_SECRET="$(grep -E '^TURN_STATIC_AUTH_SECRET=' .env | cut -d= -f2- | xargs || true)"
    TURN_PASSWORD="$(grep -E '^TURN_PASSWORD=' .env | cut -d= -f2- | xargs || true)"
    set -u

    if [[ -z "$TURN_URL" ]]; then
        log "⚠️  TURN non configuré (TURN_URL vide) → mode STUN-only."
        log "    Les appels seront MUETS derrière un NAT strict/CGNAT."
        log "    Renseigne TURN_URL + TURN_STATIC_AUTH_SECRET dans .env pour activer le relais."
        return 0
    fi

    if [[ -z "$TURN_STATIC_AUTH_SECRET" && -z "$TURN_PASSWORD" ]]; then
        log "❌ ERREUR TURN : TURN_URL=$TURN_URL est défini mais ni"
        log "   TURN_STATIC_AUTH_SECRET ni TURN_PASSWORD ne le sont."
        log "   Le client recevra une config ICE sans credentials → relais inutilisable."
        exit 1
    fi

    # turn:host:port[?transport=udp] → host / port
    turn_hostport="${TURN_URL#turn:}"
    turn_hostport="${turn_hostport#turns:}"
    turn_hostport="${turn_hostport%%\?*}"
    turn_host="${turn_hostport%%:*}"
    turn_port="${turn_hostport##*:}"
    [[ "$turn_port" == "$turn_host" ]] && turn_port=3478

    log "Healthcheck TURN sur $turn_host:$turn_port..."
    if timeout 5 bash -c "cat < /dev/null > /dev/tcp/$turn_host/$turn_port" 2>/dev/null; then
        log "✅ TURN joignable en TCP sur $turn_host:$turn_port"
    else
        log "❌ ERREUR TURN : $turn_host:$turn_port NE RÉPOND PAS."
        log "   Vérifier dans l'ordre :"
        log "     systemctl status coturn"
        log "     ls -l /etc/turnserver.conf   # doit être LISIBLE par l'utilisateur coturn"
        log "     tail -50 /var/log/turnserver/turn_*.log"
        log "     ufw status | grep -E '3478|49152'"
        log "   Les appels seraient muets derrière un NAT strict — déploiement interrompu."
        exit 1
    fi
}
turn_healthcheck

# ── CSP nginx de l'hôte : lecteur « Regarder ensemble » (YouTube) ─────────
# La CSP servie vient de /etc/nginx/sites-enabled/forgechat (pas du nginx.conf du dépôt).
# Ajout idempotent de YouTube à script-src et d'un frame-src, sur CE site seulement ;
# sauvegarde, nginx -t avant rechargement, et retour arrière si le test échoue.
watch_csp() {
    local conf=/etc/nginx/sites-enabled/forgechat
    [[ -f "$conf" ]] || { log "CSP : $conf absent, étape sautée"; return 0; }
    grep -q "youtube-nocookie" "$conf" && return 0
    grep -q "script-src 'self' 'unsafe-inline' 'unsafe-eval';" "$conf" || { log "⚠️  CSP : format inattendu, étape sautée"; return 0; }
    local bak="/root/forgechat-nginx-$(date +%Y%m%d%H%M%S).bak"
    cp -p "$conf" "$bak"
    sed -i "s#script-src 'self' 'unsafe-inline' 'unsafe-eval';#script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.youtube.com https://s.ytimg.com; frame-src https://www.youtube-nocookie.com https://www.youtube.com;#" "$conf"
    if nginx -t 2>/dev/null; then
        systemctl reload nginx && log "✅ CSP : lecteur YouTube autorisé (sauvegarde $bak)"
    else
        cp -p "$bak" "$conf"
        log "❌ CSP : nginx -t a échoué, configuration restaurée"
    fi
}
watch_csp

log ""
log "✅ ForgeChat déployé sur https://$DOMAIN"
log "   Logs serveur : docker compose logs -f server"
log "   Logs nginx   : docker compose logs -f nginx"
