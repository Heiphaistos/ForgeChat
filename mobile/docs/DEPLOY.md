# Déploiement (serveur, pré-prod, apps)

Valeurs entre `<…>` ou contenant `REMPLACER` : à renseigner par le mainteneur. Rien de secret ne va
dans le dépôt : les secrets vont dans le `.env` du VPS, les secrets Forgejo ou les identifiants EAS.

## FICHIERS À MODIFIER PAR LE MAINTENEUR

| Fichier | Où | Quoi mettre |
|---|---|---|
| `mobile/eas.json` | `build.preview.env.FORGECHAT_API_URL` | Facultatif : URL **HTTPS** de la pré-prod (`https://<domaine-preprod>`), préréglage « Pré-prod » de l'APK DEV. Vide par défaut : le serveur se choisit dans l'app (écran « Serveur »). La bêta (`build.production`) garde l'URL de prod (MAINTAINER.md §3). |
| `.env` du VPS (prod) | toutes les variables | `POSTGRES_PASSWORD`, `JWT_SECRET` (aléatoire, ≥ 32 octets ; le changer invalide sessions **et** URL signées des pièces jointes), `FRONTEND_URL`, `PUSH_ENABLED=true`, `EXPO_ACCESS_TOKEN` (expo.dev → Access tokens), `TURN_URL` / `TURN_USERNAME` / `TURN_PASSWORD`, et **`TRUSTED_PROXIES`** (voir ci-dessous). |
| `.env` du VPS (prod) | `TRUSTED_PROXIES` | Passerelle du réseau Docker du serveur, **pas seulement `127.0.0.1`** : nginx (sur l'hôte) joint le conteneur via `127.0.0.1:3013`, que le conteneur voit arriver depuis la passerelle. `docker network inspect <projet>_default --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}'` → `TRUSTED_PROXIES=127.0.0.1,::1,<passerelle>`. À ajouter aussi dans l'`environment` du service `server` de `docker-compose.yml`. |
| `nginx.conf` | `location /invites/` et `location ^~ /uploads/` | `proxy_set_header X-Real-IP $remote_addr;` et `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` (sinon un client choisit l'IP comptée par les limites de connexion via `/invites/auth/login`). Idéalement, limiter `/invites/` aux seules routes d'invitation. |
| `nginx.conf` | `location ^~ /uploads/` | Retirer `add_header Cache-Control "public, immutable"` : le serveur fixe lui-même `public` (avatars…) ou `private` (pièces jointes signées). |
| `nginx.conf` | `location /ws` | `access_log off;` (anciens clients desktop : JWT dans l'URL). |
| `nginx.conf` (si proxy Cloudflare actif) | bloc `http` ou `server` | `set_real_ip_from <plage>;` pour **chaque** plage de https://www.cloudflare.com/ips-v4 et /ips-v6, puis `real_ip_header CF-Connecting-IP;`. Jamais `real_ip_header` sans les `set_real_ip_from`. |
| `docker-compose.yml` | `server.healthcheck` | `curl -fs http://localhost:8080/api/health` (l'actuel `curl -s …/health` reçoit un 404 et passe quand même). |
| Compose de **pré-prod** | dossier séparé (ex. `/opt/forgechat-preprod`) | Copie du dépôt sur la branche `preprod`, **nom de projet** distinct (`docker compose -p forgechat-preprod`), **port** distinct (ex. `127.0.0.1:3014:8080`), volumes distincts (base, uploads), `.env` propre avec un **`JWT_SECRET` différent** de la prod, `FRONTEND_URL` de la pré-prod, `TRUSTED_PROXIES` avec la passerelle de **son** réseau. Bloc `server` nginx dédié avec certificat HTTPS. |
| Workflow `deploy-preprod.yml` | `.forgejo/workflows/` (à créer à la main, contenu ci-dessous) | Déclenché **uniquement** par un push sur la branche `preprod`. |
| Firebase / FCM | console Firebase + `npx eas-cli credentials` | Projet Firebase, apps Android `org.heiphaistos.forgechat` et `org.heiphaistos.forgechat.dev`, compte de service FCM v1 téléversé dans EAS (Push Notifications). `EAS_PROJECT_ID` dans l'environnement des builds EAS. |
| coturn | serveur TURN | Identifiants utilisés par `TURN_*` ; ports UDP/TCP ouverts. Sans TURN, les appels échouent derrière certains NAT (4G). |
| `mobile/deploy/well-known/assetlinks.json` | `sha256_cert_fingerprints` | Empreinte SHA-256 du certificat de la **clé de release** (MAINTAINER.md §4, ou `apksigner verify --print-certs`), servie en `https://<domaine>/.well-known/assetlinks.json` (`mobile/deploy/nginx-well-known.conf`). Si Play App Signing utilise une autre clé que l'upload, mettre les deux empreintes. |
| Base de données | avant chaque déploiement contenant des migrations | Sauvegarde : `docker compose exec postgres pg_dump -U forgechat -Fc forgechat > forgechat-$(date +%F).dump`. Les migrations s'appliquent seules au démarrage du serveur. |
| Prod, après déploiement de `security-fixes` | `scripts/audit-roles.sql` (lecture seule) | `docker compose exec -T postgres psql -U forgechat -d forgechat < scripts/audit-roles.sql` puis corriger rôle par rôle. |
| App desktop (Tauri) | nouvelle version | Le desktop embarque `client/dist` au moment du build : republier une version pour qu'il bénéficie des correctifs web. |

## Workflow de pré-prod (`.forgejo/workflows/deploy-preprod.yml`)

À créer par le mainteneur. Secrets Forgejo : ceux de la prod (`VPS_SSH_KEY`, `VPS_HOST`, `VPS_USER`),
ou des secrets dédiés si la pré-prod est sur une autre machine.

```yaml
name: Deploy ForgeChat (pré-prod)

on:
  push:
    branches: [preprod]   # jamais main : un push sur main déploie la PROD

jobs:
  deploy:
    name: Deploy to pré-prod
    runs-on: ubuntu-latest
    steps:
      - name: Setup SSH
        run: |
          install -m 700 -d ~/.ssh
          echo "${{ secrets.VPS_SSH_KEY }}" | base64 --decode > ~/.ssh/id_deploy
          chmod 600 ~/.ssh/id_deploy
          ssh-keyscan -H ${{ secrets.VPS_HOST }} > ~/.ssh/known_hosts 2>/dev/null

      - name: Deploy via SSH
        run: |
          ssh -i ~/.ssh/id_deploy -o BatchMode=yes \
            ${{ secrets.VPS_USER }}@${{ secrets.VPS_HOST }} << 'ENDSSH'
          set -e
          cd /opt/forgechat-preprod
          docker compose -p forgechat-preprod exec -T postgres pg_dump -U forgechat -Fc forgechat > ../preprod-avant-$(date +%F-%H%M).dump
          git fetch origin preprod
          git reset --hard origin/preprod
          cd client && npm ci --prefer-offline && npm run build && cd ..
          export GIT_SHA=$(git rev-parse HEAD)
          docker compose -p forgechat-preprod up -d --build --remove-orphans
          echo "Pré-prod : $(git rev-parse --short HEAD) déployé le $(date -u)"
          ENDSSH

      - name: Cleanup
        if: always()
        run: rm -f ~/.ssh/id_deploy
```

## Ordre de déploiement

1. Pré-prod d'abord (branche `preprod`), avec sauvegarde de la base avant les migrations.
2. Tests sur la pré-prod avec le dev-apk (et l'accord du mainteneur pour les e2e).
3. Prod (branche `main`), sauvegarde avant, `audit-roles.sql` après.
4. Builds (EAS ou local) : APK DEV puis bêta, vérification `scripts/release-apk.sh`, publication
   (docs/MAINTAINER.md §3 et §6).
