# Audit de sécurité ForgeChat — 2026-10-10

Périmètre : server/ (Rust/Axum), client/ (web), desktop/ (Tauri), mobile/ (Expo), CI, Docker, nginx, historique Git.
Lecture seule. Versions : srv 3.300.0, web 3.659.0, desktop 3.54.0, mobile 1.27.0 (commit 7d58eed3).

Bilan : 0 critique · 7 hautes · 14 moyennes · ~20 faibles.
Aucune régression des correctifs du 2026-09-23. Pas d'injection SQL. SSRF bien filtré (net_guard). Pas de XSS trouvée.
Aucun secret dans l'historique Git : gitleaks a sorti 18 résultats, tous des faux positifs.
En-têtes HTTP de prod vérifiés par curl : HSTS, X-Frame-Options, nosniff, Referrer-Policy et Permissions-Policy présents ; `/uploads` servi en `sandbox`.

## HAUTE

| # | Faille | Où | Statut |
|---|---|---|---|
| H1 | Limite de connexion contournable : (a) le compteur par IP est remis à zéro par toute connexion réussie, y compris sur le compte de l'attaquant ; (b) `client_key` fait confiance à X-Real-IP/X-Forwarded-For, et `/invites/auth/login` atteint l'API en prod. Brute-force illimité du mot de passe, du TOTP et des codes de secours | server/src/handlers/auth.rs:351, privacy.rs:33, nginx `location /invites/` | CONFIRMÉ (a) ; (b) route joignable en prod, en-tête nginx à vérifier |
| H2 | E2E : la clé privée est protégée par le mot de passe de connexion, que le serveur reçoit en clair. Un VPS compromis lit toutes les conversations des utilisateurs qui se connectent | client/src/e2e/accountKey.ts:70,146,155 ; même schéma sur mobile ; docs/CHIFFREMENT-E2E.md §3 | CONFIRMÉ (conception) |
| H3 | E2E : les clés publiques des membres et la clé « serveur » (séquestre) viennent du serveur. L'empreinte n'est jamais recalculée par le client, le premier contact n'est pas vérifié et un changement de clé n'est qu'une bannière. MITM actif possible par le serveur | client et mobile src/e2e/conversations.ts:149-168,555-575, E2EBadge.tsx | CONFIRMÉ |
| H4 | Mise à jour desktop non signée : l'URL et le SHA-256 viennent du même serveur, aucune clé publique n'est embarquée. VPS ou release compromis = exécution de code chez tous les utilisateurs PC | desktop/src-tauri/src/updater.rs:19-30,277-334 | CONFIRMÉ |
| H5 | CI : `contents: write` sur tous les jobs de build, et `curl llvm.sh \| sudo bash`. Une dépendance compromise peut remplacer un binaire de la release, et SHA256SUMS est recalculé ensuite | .github/workflows/applications.yml:47-346 | PLAUSIBLE |

## MOYENNE

| # | Faille | Où |
|---|---|---|
| M1 | `GET /users/search` renvoie la date de naissance, l'état du 2FA et l'activité (oubli de `for_others()`) | server/src/handlers/users.rs:435 |
| M2 | Inscription sans vérification de l'email. `fc_is_god` est lié à l'email : si le compte propriétaire est supprimé, quiconque s'inscrit avec cette adresse obtient tous les pouvoirs | handlers/auth.rs:168-201, migrations/098_el_patron.sql |
| M3 | Surcharges de salon : un détenteur d'EDIT_CHANNELS peut s'accorder n'importe quel bit, y compris VIEW_CHANNEL sur un salon privé, et reçoit alors les clés E2E | handlers/channels.rs:541-568 |
| M4 | E2E salons : un membre peut empoisonner une enveloppe de façon irréparable ou s'approprier une nouvelle époque | handlers/e2e_conv.rs:152-165,466-515 |
| M5 | Corps HTTP sortants lus sans plafond (flux RSS, aperçu OG) : saturation de la mémoire | handlers/feeds.rs:261, handlers/audit.rs:707 |
| M6 | Le WebSocket survit à la déconnexion et au changement de mot de passe | handlers/websocket.rs:189 |
| M7 | Code TOTP rejouable au login. `totp_secret` et les codes de secours sont stockés en clair, et ces codes ne font que 32 bits | handlers/auth.rs:~340, handlers/totp.rs:41 |
| M8 | Import Discord : taille décompressée illimitée (zip bomb) | handlers/discord_import/importer.rs:472 |
| M9 | Mise à jour desktop redirigeable par la variable `FORGECHAT_UPDATE_ENDPOINT` en release | updater.rs:232 |
| M10 | Desktop : JWT et refresh token en localStorage, `withGlobalTauri`, scripts YouTube autorisés par la CSP | client/src/api/client.ts:57-69, tauri.conf.json |
| M11 | CSP de prod avec `'unsafe-inline' 'unsafe-eval'` dans script-src | nginx de prod |
| M12 | Déploiement : `deploy.sh` en root toutes les 2 min depuis la branche par défaut, workflow Forgejo en root avec `ssh-keyscan` en mode TOFU | deploy/deploy.sh, .forgejo/workflows/deploy.yml |
| M13 | Keystore Android accessible à tout `workflow_dispatch`, sans Environment protégé | applications.yml |
| M14 | Mobile : commentaires affirmant que le SHA-256 de l'APK/IPA est vérifié, ce qui est faux (seul l'hôte l'est) ; IPA installée sans contrôle | mobile/src/features/updates/installer.ts:28, updateCheck.ts:6-24 |

## FAIBLE

- WebSocket : pas de `max_message_size`/`max_frame_size` (64 Mio acceptés avant le test à 64 Ko), pas de plafond de sockets.
- DM_CALL_ACCEPT sans appel en sonnerie : contourne le blocage.
- VOICE_JOIN, SOUNDBOARD et VOICE_REACTION sans VIEW_CHANNEL ni contrôle de présence (UUID requis).
- Historique d'éditions et rappels sur un message d'un salon masqué (UUID requis).
- `/users/:id/profile` public sans authentification.
- Redis coupé = révocation et anti-brute-force désactivés (fail-open).
- `JWT_SECRET` non contrôlé au démarrage (longueur, valeur d'exemple).
- `/uploads` public par UUID (anciens fichiers en clair, avatars).
- JWT dans l'URL du WebSocket Tauri.
- Énumération des emails à l'inscription. `revoke_session` laisse le jeton d'accès valide jusqu'à 1 h. `accounts.rs:60` limite sur l'IP de nginx. Compteur du webhook consommé avant la vérification du jeton. TURN statique distribué. `get_emoji` sans contrôle.
- Lien Markdown dont le texte affiché diffère de la cible (phishing).
- Ouverture via le shell Tauri : `http://` en clair et `ghosthanddesk://` sans confirmation.
- Mobile : `WatchPlayer.tsx:37` openURL sans filtre https ; `originWhitelist` http sur AiEngineHost ; mot de passe gardé en mémoire en cas d'échec.
- `cargo audit` : serveur `rsa` (Marvin, inatteignable en HS256) ; desktop quick-xml, event-listener, glib (dépendances transitives de Tauri).
- `npm audit` mobile : 37 alertes, toutes dans l'outillage Expo/RN, pas dans l'APK.
- Infra : healthcheck `curl -s localhost` toujours vrai ; images non pinnées par digest ; service releases-sync en root ; IP du VPS et `VPS_USER=root` dans SETUP_VPS.md, alors que le dépôt passe en public pendant les builds ; email personnel par défaut dans `FORGECHAT_ADMIN_EMAIL`.
- `nginx.conf` du dépôt périmé : headers non hérités et 1100M global. La prod est correcte pour les headers ; la limite de taille reste à vérifier.
