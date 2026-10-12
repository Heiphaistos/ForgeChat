# Passer PostgreSQL de 16 à 18 (procédure manuelle)

La PR Dependabot `postgres 16-alpine -> 18-alpine` n'a **pas** été appliquée : une version majeure de
PostgreSQL ne lit pas le répertoire de données d'une autre. Changer seulement la ligne `image:` de
`docker-compose.yml` ferait refuser le démarrage du conteneur sur le volume existant
(`forgechat_forgechat_pgdata`) avec « database files are incompatible with server ». Dependabot ignore
désormais les versions majeures de `postgres` (`.github/dependabot.yml`) ; la montée se fait à la main,
par sauvegarde puis restauration, avec une fenêtre de maintenance.

Points propres à l'image 18 :

- `PGDATA` vaut désormais `/var/lib/postgresql/18/docker` et l'image attend le volume monté sur
  `/var/lib/postgresql` (et non plus `/var/lib/postgresql/data`) ;
- les sommes de contrôle des pages sont activées par défaut à l'`initdb` ;
- l'authentification `md5` est dépréciée (le défaut reste `scram-sha-256`, rien à faire ici).

## Procédure (en root sur le VPS, dans `/opt/forgechat`)

```bash
cd /opt/forgechat
stamp=$(date +%Y%m%d%H%M%S)

# 1. Couper les écritures : seul postgres reste en marche.
docker compose stop server

# 2. Sauvegarde complète (format custom) + copie chiffrée habituelle par sécurité.
docker compose exec -T postgres pg_dump -U forgechat -d forgechat -Fc --no-owner > /root/forgechat-pg16-$stamp.dump
/opt/forgechat/deploy/backup/forgechat-backup.sh   # sauvegarde age habituelle, en plus
docker compose exec -T postgres psql -U forgechat -d forgechat -Atc \
  "select count(*) from users; select count(*) from messages;" > /root/forgechat-pg16-$stamp.counts

# 3. Arrêter postgres et mettre l'ancien volume de côté (on ne le supprime pas).
docker compose stop postgres
docker volume create forgechat_forgechat_pgdata18

# 4. Dans docker-compose.yml :
#    - image: postgres:18-alpine@sha256:<empreinte du jour>
#    - volume : pgdata:/var/lib/postgresql   (au lieu de /var/lib/postgresql/data)
#    - volumes.pgdata.name: forgechat_forgechat_pgdata18
docker compose up -d postgres
until docker compose exec -T postgres pg_isready -U forgechat -q; do sleep 2; done

# 5. Restaurer puis vérifier les comptes.
docker compose exec -T postgres pg_restore -U forgechat -d forgechat --no-owner --exit-on-error \
  < /root/forgechat-pg16-$stamp.dump
docker compose exec -T postgres psql -U forgechat -d forgechat -c "ANALYZE;"
docker compose exec -T postgres psql -U forgechat -d forgechat -Atc \
  "select count(*) from users; select count(*) from messages;" | diff - /root/forgechat-pg16-$stamp.counts \
  && echo "comptes identiques"

# 6. Relancer le serveur (les migrations sqlx ne doivent rien avoir à appliquer).
docker compose up -d server
docker compose logs --tail=50 server
```

Retour arrière : remettre l'image 16, le point de montage `/var/lib/postgresql/data` et le nom de
volume `forgechat_forgechat_pgdata`, puis `docker compose up -d`. L'ancien volume n'a pas été modifié.
Le supprimer seulement après quelques jours sans incident et une sauvegarde age vérifiée
(`deploy/backup/forgechat-restore-test.sh`).

Penser aussi à aligner le service `postgres` de `.github/workflows/ci.yml` (actuellement `postgres:16`).
