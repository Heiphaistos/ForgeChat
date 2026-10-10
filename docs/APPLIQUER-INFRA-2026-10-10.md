# Appliquer en production les correctifs d'infrastructure du 2026-10-10

Correctifs préparés dans le dépôt (branche `sec-infra`) ; rien n'est appliqué automatiquement au VPS
hors `deploy.sh`. Les commandes sont à lancer en root sur le VPS, dans cet ordre.

## 0. AVANT de fusionner dans la branche par défaut

`docker-compose.yml` exige désormais `FORGECHAT_ADMIN_EMAIL` (plus de valeur par défaut) et, avec
la branche `sec-auth`, `TOTP_ENC_KEY`. Sans elles, `deploy.sh` (lancé par `deployer-auto` deux
minutes après le push) échoue au `docker compose up`.

```bash
cd /opt/forgechat
cp -p .env /root/forgechat-env-$(date +%Y%m%d%H%M%S).bak
grep -q '^FORGECHAT_ADMIN_EMAIL=.' .env || echo 'FORGECHAT_ADMIN_EMAIL=<e-mail du propriétaire>' >> .env
# Clé de chiffrement des secrets 2FA : générée UNE fois, à sauvegarder (la perdre = 2FA à refaire).
grep -q '^TOTP_ENC_KEY=.' .env || echo "TOTP_ENC_KEY=$(openssl rand -base64 32)" >> .env
# Phase 2 (sec2-srv) : clé de chiffrement des adresses e-mail, même règle (la perdre = adresses illisibles).
grep -q '^EMAIL_ENC_KEY=.' .env || echo "EMAIL_ENC_KEY=$(openssl rand -base64 32)" >> .env
chmod 600 .env
docker compose config -q && echo "compose OK"
```

## 1. nginx (site forgechat)

`nginx.conf` du dépôt est maintenant la copie de référence de `/etc/nginx/sites-enabled/forgechat`.

```bash
B=/root/forgechat-nginx-$(date +%Y%m%d%H%M%S).bak
cp -p /etc/nginx/sites-enabled/forgechat "$B"
install -m 644 /opt/forgechat/nginx.conf /etc/nginx/sites-enabled/forgechat
if nginx -t; then systemctl reload nginx && echo "rechargé (sauvegarde $B)"; else cp -p "$B" /etc/nginx/sites-enabled/forgechat && echo "RESTAURÉ"; fi
```

Ce qui change par rapport à la production :
- `X-Real-IP` / `X-Forwarded-For` = `$remote_addr` dans toutes les locations proxifiées (`/ws` et
  `/invites/`, `/uploads/` n'en avaient pas) ;
- `limit_req_zone forgechat_auth` (10 r/min, rafale 5, réponse 429) sur
  `/api/auth/(login|prelogin|register|verify-email|forgot-password|reset-password|2fa/*)` ;
- `client_max_body_size 1m` par défaut ; 1100M seulement sur `…/attachments` et `…/forum-uploads`,
  12m sur avatar, bannière, icônes, emojis, stickers, sons ;
- snippet `security-headers.conf` ré-inclus dans `/ai-models/` (sinon HSTS et X-Frame-Options y
  disparaissaient) ;
- CSP : `script-src 'self' 'wasm-unsafe-eval' …` (plus de `'unsafe-inline'` ni `'unsafe-eval'`) ;
- `server_tokens off` est déjà dans `/etc/nginx/nginx.conf` ; `X-XSS-Protection` n'est plus envoyé.

Vérifications :

```bash
curl -sI https://forgechat.heiphaistos.org/ | grep -i -E 'content-security|strict-transport|server:'
for i in $(seq 8); do curl -s -o /dev/null -w '%{http_code} ' -X POST https://forgechat.heiphaistos.org/api/auth/forgot-password -H 'content-type: application/json' -d '{}'; done; echo   # derniers = 429
```

Puis dans le navigateur (console ouverte, aucune violation CSP attendue) : connexion, traduction /
transcription IA sur l'appareil, débruitage du micro, fond flou ou virtuel en vidéo, « Regarder
ensemble » YouTube, envoi d'une pièce jointe > 12 Mo, changement d'avatar.
Retour arrière : `cp -p "$B" /etc/nginx/sites-enabled/forgechat && nginx -t && systemctl reload nginx`.

`deploy.sh` ne réécrit plus la CSP (l'ancienne étape `watch_csp` aurait remis `'unsafe-eval'`).

## 2. Synchronisation des releases : utilisateur dédié + signature

```bash
id forgechat-sync 2>/dev/null || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin forgechat-sync
chown root:forgechat-sync /etc/forgechat /etc/forgechat/releases-token
chmod 750 /etc/forgechat
chmod 640 /etc/forgechat/releases-token
chown -R forgechat-sync:forgechat-sync /var/www/forgechat-desktop
install -m 755 /opt/forgechat/deploy/forgechat_releases_sync.py /usr/local/sbin/forgechat_releases_sync.py
install -m 644 /opt/forgechat/deploy/forgechat-releases-sync.service /etc/systemd/system/forgechat-releases-sync.service
systemctl daemon-reload
python3 -I /opt/forgechat/deploy/test_forgechat_releases_sync.py      # OK attendu (openssl ed25519)
systemctl start forgechat-releases-sync.service
systemctl status forgechat-releases-sync.service --no-pager | head -5
journalctl -u forgechat-releases-sync -n 20 --no-pager
```

Les releases déjà publiées n'ont pas de signature : le service les laisse telles quelles, sans
erreur. Pour les signer rétroactivement : `docs/PUBLICATION-SIGNEE.md`, section Transition.

## 3. GitHub : Environment `android-release`

Commandes à lancer sur le PC (`gh` connecté). Les valeurs ne s'affichent pas.

```bash
R=Heiphaistos/ForgeChat
gh api -X PUT repos/$R/environments/android-release --input - <<'EOF'
{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
EOF
gh api -X POST repos/$R/environments/android-release/deployment-branch-policies -f name='mobile-v*' -f type=tag
base64 -w0 /d/MDP/forgechat-android/forgechat-release.jks | gh secret set ANDROID_KEYSTORE_B64 --env android-release --repo $R
tr -d '\r\n' < /d/MDP/forgechat-android/password.txt | gh secret set ANDROID_KEYSTORE_PASSWORD --env android-release --repo $R
gh secret list --env android-release --repo $R
# Une fois un build mobile réussi avec l'Environment : retirer les secrets du niveau dépôt,
# sinon n'importe quel workflow peut encore les lire.
gh secret delete ANDROID_KEYSTORE_B64 --repo $R
gh secret delete ANDROID_KEYSTORE_PASSWORD --repo $R
```

Aucun relecteur requis. Si GitHub refuse l'Environment sur un dépôt privé avec un compte gratuit,
lancer ces commandes pendant que le dépôt est public (il l'est pendant les builds).

## 4. Forgejo

`.forgejo/workflows/deploy.yml` est supprimé (déploiement SSH en root, `known_hosts` en TOFU,
contournait `deploy.sh`). Sur Forgejo : supprimer les secrets `VPS_SSH_KEY`, `VPS_HOST`, `VPS_USER`
du dépôt ForgeChat, et retirer de `/root/.ssh/authorized_keys` du VPS la clé publique qui leur
correspondait si elle n'a plus d'autre usage.
