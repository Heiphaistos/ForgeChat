#!/bin/bash
# Test de restauration (amélioration n° 15) — à lancer chaque mois sur VOTRE machine, jamais sur
# le VPS : il faut la clé privée age.
#
#   ./forgechat-restore-test.sh ~/cles/forgechat-backup.key db-20261012T030000Z.dump.age [SHA256SUMS-….txt]
#
# Déchiffre la sauvegarde, la restaure dans un PostgreSQL jetable (Docker, sans réseau), vérifie
# que les tables principales sont là et non vides, puis efface tout.
set -euo pipefail
umask 077
KEY=${1:?clé privée age}
DUMP=${2:?fichier db-….dump.age}
SUMS=${3:-}

if [ -n "$SUMS" ]; then
  (cd "$(dirname "$DUMP")" && grep " ./$(basename "$DUMP")$" "$(basename "$SUMS")" | sha256sum -c -)
fi

name=fc-restore-test-$$
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$name" --network none -e POSTGRES_PASSWORD=test -e POSTGRES_DB=forgechat \
  postgres:16-alpine >/dev/null
for _ in $(seq 60); do docker exec "$name" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done

age -d -i "$KEY" "$DUMP" | docker exec -i "$name" pg_restore -U postgres -d forgechat --no-owner --exit-on-error

ok=1
for t in users servers channels messages dm_messages user_keys; do
  n=$(docker exec "$name" psql -U postgres -d forgechat -tAc "SELECT count(*) FROM $t" 2>/dev/null || echo "ABSENTE")
  printf '%-20s %s\n' "$t" "$n"
  [ "$n" = "ABSENTE" ] && ok=0
done
[ "$(docker exec "$name" psql -U postgres -d forgechat -tAc 'SELECT count(*) FROM users')" -gt 0 ] || ok=0
if [ "$ok" = 1 ]; then echo "RESTAURATION OK"; else echo "RESTAURATION EN ÉCHEC" >&2; exit 1; fi
