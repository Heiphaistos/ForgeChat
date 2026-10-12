#!/bin/bash
# Sauvegarde chiffrée de ForgeChat (amélioration n° 15, 2026-10-12).
#
# - base PostgreSQL (pg_dump, format custom) + fichiers envoyés (volume uploads) ;
# - chiffrés avec age vers les CLÉS PUBLIQUES de /etc/forgechat/backup-recipients.txt : la clé
#   privée n'est JAMAIS sur le VPS (un attaquant qui prend le serveur ne lit pas les sauvegardes) ;
# - empreintes SHA-256, rotation locale (BACKUP_KEEP_DAYS), copie hors du VPS si
#   BACKUP_RCLONE_REMOTE est défini (rclone, ex. « b2:forgechat-backups »).
#
# Réglages : /etc/forgechat/backup.env (facultatif). Lancé chaque nuit par forgechat-backup.timer.
# Test de restauration : deploy/backup/forgechat-restore-test.sh, sur VOTRE machine (clé privée).
set -euo pipefail
umask 077

ENV_FILE=/etc/forgechat/backup.env
[ -f "$ENV_FILE" ] && . "$ENV_FILE"
APP_DIR=${APP_DIR:-/opt/forgechat}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/forgechat}
RECIPIENTS=${RECIPIENTS:-/etc/forgechat/backup-recipients.txt}
KEEP_DAYS=${BACKUP_KEEP_DAYS:-14}

command -v age >/dev/null || { echo "age manquant : apt install age" >&2; exit 1; }
[ -s "$RECIPIENTS" ] || { echo "$RECIPIENTS vide : ajoutez la clé publique age (age1…)" >&2; exit 1; }
if grep -q "AGE-SECRET-KEY" "$RECIPIENTS"; then
  echo "REFUS : $RECIPIENTS contient une clé PRIVÉE. Seules les clés publiques age1… vont sur le VPS." >&2
  exit 1
fi

stamp=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$BACKUP_DIR"
work=$(mktemp -d "$BACKUP_DIR/.tmp-$stamp-XXXX")
trap 'rm -rf "$work"' EXIT
cd "$APP_DIR"

# Rien n'est écrit en clair sur le disque : les flux vont directement dans age.
docker compose exec -T postgres pg_dump -U forgechat -d forgechat -Fc --no-owner \
  | age -R "$RECIPIENTS" -o "$work/db-$stamp.dump.age"
docker compose cp server:/app/uploads - \
  | age -R "$RECIPIENTS" -o "$work/uploads-$stamp.tar.age"

# Une sauvegarde vide ou tronquée ne doit jamais remplacer les bonnes.
for f in "$work"/*.age; do
  [ "$(stat -c %s "$f")" -gt 1024 ] || { echo "Sauvegarde suspecte (trop petite) : $f" >&2; exit 1; }
done
(cd "$work" && sha256sum ./*.age > "SHA256SUMS-$stamp.txt")
mv "$work"/* "$BACKUP_DIR"/

if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
  rclone copy --immutable "$BACKUP_DIR" "$BACKUP_RCLONE_REMOTE" \
    --include "*-$stamp.*" --include "SHA256SUMS-$stamp.txt"
fi

find "$BACKUP_DIR" -maxdepth 1 -type f -name '*-20*' -mtime +"$KEEP_DAYS" -delete
echo "Sauvegarde $stamp terminée : $(du -ch "$BACKUP_DIR"/*-"$stamp".* | tail -1 | cut -f1)"
