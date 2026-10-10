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
# --pull : l'image de base du serveur est retirée à chaque build (correctifs de sécurité Debian),
# le Dockerfile ne fait plus d'apt-get upgrade.
docker compose build --pull
docker compose up -d --remove-orphans

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

# ── Journaux minimaux : ni accès nginx (IP, URL) ni journal coturn ─────────
# Prudence : idempotent (marqueur), sauvegarde, test avant
# rechargement, retour arrière si échec. Seul le site forgechat est touché.
anon_logs() {
    local conf=/etc/nginx/sites-enabled/forgechat mark="# forgechat-anonymat"
    if [[ -f "$conf" ]] && ! grep -q "$mark" "$conf"; then
        local bak="/root/forgechat-nginx-$(date +%Y%m%d%H%M%S).bak"
        cp -p "$conf" "$bak"
        # Après chaque server_name : niveau du bloc server (HTTP et HTTPS).
        sed -i "/^[[:space:]]*server_name[[:space:]]/a\    access_log off; $mark" "$conf"
        if nginx -t 2>/dev/null; then
            systemctl reload nginx && log "✅ nginx : journal d'accès coupé (sauvegarde $bak)"
        else
            cp -p "$bak" "$conf"
            log "❌ nginx : nginx -t a échoué, configuration restaurée"
        fi
    fi

    # coturn : plus aucun journal (il y écrivait IP et nom de chaque relais).
    local tc=/etc/turnserver.conf
    [[ -f "$tc" ]] || return 0
    grep -q "^log-file=/dev/null" "$tc" && return 0
    # Jamais démarrer un coturn arrêté exprès : seulement s'il tourne déjà.
    systemctl is-active --quiet coturn || { log "coturn inactif : journaux laissés tels quels"; return 0; }
    local tbak="/root/forgechat-turnserver-$(date +%Y%m%d%H%M%S).bak"
    cp -p "$tc" "$tbak"
    # Les anciennes destinations de journal sont commentées, pas supprimées.
    sed -i -E 's/^[[:space:]]*(log-file|syslog|verbose|Verbose)\b/#&/' "$tc"
    {
        echo ""
        echo "$mark : aucun journal"
        echo "no-stdout-log"
        grep -q "^simple-log" "$tc" || echo "simple-log"
        echo "log-file=/dev/null"
    } >> "$tc"
    local host="${turn_host:-127.0.0.1}" port="${turn_port:-3478}"
    systemctl restart coturn
    sleep 2
    if systemctl is-active --quiet coturn \
        && timeout 5 bash -c "cat < /dev/null > /dev/tcp/$host/$port" 2>/dev/null; then
        log "✅ coturn : journaux coupés, répond sur $host:$port (sauvegarde $tbak)"
    else
        cp -p "$tbak" "$tc"
        systemctl restart coturn
        log "❌ coturn ne répondait plus : configuration restaurée ($tbak)"
    fi
}
anon_logs

log ""
log "✅ ForgeChat déployé sur https://$DOMAIN"
log "   Logs serveur : docker compose logs -f server"
log "   Logs nginx   : docker compose logs -f nginx"
