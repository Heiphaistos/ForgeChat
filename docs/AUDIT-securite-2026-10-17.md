# Audit de sécurité ForgeChat — 2026-10-17

Périmètre : serveur Rust (Axum), client web (React/Vite), application de bureau Tauri (Windows, Linux, macOS), application mobile Expo (Android, iOS), infrastructure (nginx hôte, Docker Compose, deploy.sh, CI). Base auditée : `b8d78072a` (srv 3.321.0 / web 3.686.0 / desktop 3.78.0 / mobile 1.48.0), en production au moment de l'audit.

Méthode : cinq lectures indépendantes du code (serveur auth/transport, serveur métier, web, mobile, desktop + infra), chaque constat cité avec fichier et ligne, puis correction sur des branches séparées, tests, fusion. Baseline vérifiée avant toute correction : 305 tests unitaires + 46 tests base + 1 test de compteurs serveur ; tsc, eslint, 48 fichiers de tests et build web ; tout vert.

Bilan : **0 critique**, 4 hautes, ~30 moyennes, ~40 faibles. Tout ce qui est listé ci-dessous comme « corrigé » l'est dans srv 3.322.0 / web 3.687.0 / desktop 3.79.0 / mobile 1.49.0.

## 1. Hautes (toutes corrigées)

| # | Où | Problème | Correction |
|---|----|----------|------------|
| H1 | web `store/call.ts`, `groupCall.ts`, `voiceSfu.ts` ; mobile `stores/call.ts`, `groupCall.ts`, `voice.ts` | Le chiffrement des médias LiveKit n'était activé que si le serveur annonçait `e2ee:true`. Un serveur menteur faisait rejoindre l'appel en clair sans erreur. | `openMediaE2EE` toujours appelé dès que la clé de compte est prête ; sans clé, refus de rejoindre (message FR). Le drapeau servi est ignoré. |
| H2 | desktop `tauri.conf.json`, `nginx.conf` | `script-src` autorisait `www.youtube.com` et `s.ytimg.com` dans l'origine qui porte l'IPC Tauri (jetons, trousseau, updater). | « Regarder ensemble » pilote désormais une iframe `youtube-nocookie` en postMessage (`lib/youtubeEmbed.ts`), origine et `source` vérifiés ; l'API IFrame n'est plus chargée ; les deux hôtes sont retirés des deux CSP. |
| H3 | serveur `servers.rs`, `templates.rs` | `description`, `welcome_message`, `verification_rules` sans borne (corps de 12 Mo), renvoyés dans `/explore`, la découverte, `SERVER_UPDATE` et la route publique `get_invite_info`. | Bornes en caractères (1000 / 2000 / 4000), nom 2–100, sur toutes les écritures. |
| H4 | infra | La garde de déploiement signé (`deploy/verify-signed-head.sh`) n'a jamais été installée sur le VPS : un push sur `main` exécute du code en production. | **Non installée** : exige de signer chaque commit (clé + `allowed_signers` sur le VPS), ce qui bloquerait les push de Claude sans clé dédiée. Décision à prendre par le propriétaire (voir §6). En attendant : sauvegarde + retour arrière automatiques dans `deploy.sh`. |

## 2. Serveur

Auth / transport (branche fc-fix-srv-a) :
- 2FA : `POST /auth/2fa/setup` exige la preuve du mot de passe (`{auth}`) ; `confirm` ferme toutes les autres sessions. Un jeton volé ne peut plus poser un 2FA et verrouiller le compte.
- Quota d'envoi (5 Gio) réservé dans Redis avant écriture (`INCRBY`, TTL 30 min, rendu au `Drop`), fail-closed : plus de dépassement par envois parallèles.
- WebSocket : 800 messages texte / 10 s par compte toutes sockets confondues (fermeture au-delà), limiteurs `TYPING*` indexés par compte (plus par un UUID choisi par le client), `GROUP_CALL_JOIN` 10/min, `TYPING` de groupe vérifie l'appartenance, champs relayés (`dm_id`, `call_type`, `tool`, `color`, `size`) typés et bornés.
- Connexion : coût bcrypt constant (hash factice si la preuve est mal formée ou le compte inconnu), plus de 426 avant preuve valide : fin de l'énumération par timing et par code.
- Inscription : une demande en attente non expirée n'est plus écrasée ; `verify-email` n'efface plus la demande au 5e mauvais code (compteurs par adresse et par IP, 10 essais).
- Réinitialisation : révocation des jetons avant le commit ; réutilisation d'un refresh token consommé hors grâce = session fermée (détection de vol, trace 24 h).
- Export RGPD : `POST /users/me/data-export` avec preuve, flux JSON paginé (mémoire bornée).
- Clés de serveur : El Patron n'est plus traité comme propriétaire des enveloppes. Éjection du SFU étendue aux appels de groupe. Limiteur push mobile fail-closed. `X-Real-IP` cru seulement depuis `TRUSTED_PROXIES` (défaut : boucle locale + réseaux privés).

Métier (branche fc-fix-srv-b, migration 141) :
- `remove_timeout` : hiérarchie exigée, interdit sur soi-même.
- Mode lent et anti-spam appliqués aux fils, posts et réponses de forum, sondages (y compris `/poll`), messages programmés.
- Webhooks supprimés au kick/ban/départ de leur créateur ; exécution refusée si le créateur n'est plus membre.
- Serveur suspendu : plus de jonction, de webhook, de flux RSS, de découverte, ni d'action de permission ; seul le propriétaire peut supprimer.
- Nouveau `require_channel_manage` : purge, jeton GitHub, archivage, déplacement, tags, surcharges, flux RSS, messages éphémères, salle d'attente respectent les surcharges du salon. Nouveau `require_manage_messages` (permissions effectives) pour suppression, épingles, fils, forum, clôture de sondage.
- Tickets : plafond de salons, 10 tickets / 7 jours par membre, clôture et réouverture réservées à l'équipe (colonne `closed_by`).
- Actualités : `public:true` réservé aux serveurs autorisés par l'administration (`news_public_allowed`, route `PUT /admin/servers/:id/news-public`), 200 sites par serveur.
- Sauvegarde de catégorie plafonnée à 200 000 messages (`truncated`). Porte de vérification appliquée côté serveur (`require_can_post`). Lever un verrouillage exige MANAGE_SERVER. Starboard : salon privé détecté par les permissions effectives. `media_url` du forum lié à l'envoi de l'auteur. `update_server` : bannière locale seule, salons système vérifiés, `afk_timeout` et `content_filter` bornés. Événements (50 à venir) et tâches (200 par salon) : droits et quotas. `parent_message_id` vérifié, 20 émojis distincts par message. Groupes privés : ré-ajout d'un exclu réservé au propriétaire, blocages vérifiés avec tout le groupe (`group_dm_excluded`). Journal d'audit : BOT_CREATE/DELETE/TOKEN_REGEN, WEBHOOK_CREATE/DELETE, INVITE_CREATE. Invitations : 7 jours par défaut, heures fractionnaires (l'option « 30 min » renvoyait 422), liste à 500. Transfert de propriété : mot de passe + TOTP. 25 bots par serveur, nom de bot unique, BAN_TEMP ≤ 30 jours. `/explore` : activité mise en cache 5 min.

## 3. Client web

- E2E : émetteur d'enveloppe épinglé seulement si le journal de transparence le confirme (`keyLogged`) ; `mustEncrypt` lève `E2E_LOCKED` quand la clé est verrouillée (plus de fichier ou de transfert en clair) ; journal de transparence : hash et chaînage vérifiés, `kt_seq` absent = refus ; liste locale des 26 commandes natives ; avertissement bloquant avant une connexion « ancienne » sur un appareil inconnu.
- Aperçus de liens désactivés par défaut (le serveur n'apprend plus l'URL d'un message chiffré sans accord), réglage dans Confidentialité.
- Images d'actualités et d'aperçus via le proxy `/og/image` (`useProxiedImage`) : plus de fuite d'IP, CSP `img-src` en liste blanche.
- Service worker : redirection `//evil` refusée ; déconnexion : échec de révocation signalé, données locales effacées ; cache hors ligne effacé à l'expiration de session.
- Preuve du mot de passe demandée (`PasswordPrompt`) pour l'activation du 2FA, l'export RGPD et le transfert de propriété (+ code 2FA).
- Réglage bureau « Joindre le journal de l'application aux rapports de problème » (faux par défaut).

## 4. Application de bureau

- Feature `devtools` hors des builds release. Updater : installeur Windows rouvert en `FILE_SHARE_READ` et re-haché juste avant le lancement élevé (handle tenu jusqu'à la sortie) ; portable écrit en `create_new` sous un nom aléatoire. `save_file` en `create_new` avec réessai.
- Journal `forgechat.log` en 0600, console WebKit seulement en debug, envoi du journal au serveur soumis au réglage `send_logs`.
- Permission média WebKitGTK accordée seulement à l'origine de l'application ; schéma `forgechat://` (sans handler) retiré ; `nv_popout` limité au port réel du serveur vidéo local ; serveur MJPEG local plafonné (16 connexions, timeout 10 s).
- CSP : `img-src` en liste blanche ; cible macOS ajoutée au manifeste de publication.
- Non fait (certificats requis) : signature Authenticode et notarisation macOS.

## 5. Application mobile

- Moteur d'IA : la page et ses 5 scripts sont téléchargés puis comparés à des SHA-256 embarqués (`engineHashes.ts`, SRI) avant d'être injectés dans la WebView ; au moindre écart, refus. **À chaque release web qui change la page moteur : `node mobile/scripts/ai-engine-hashes.mjs client/dist` puis nouvelle release mobile.** Reste : le Worker n'est pas couvert par le SRI (embarquement complet à planifier).
- Parité avec le web : E2EE média forcé, `keyLogged` à la première vue, `mustEncrypt` verrouillé, journal de transparence vérifié, aperçus de liens désactivés par défaut, liste locale des commandes natives, preuves pour 2FA / export / transfert.
- SecureStore : échec d'écriture journalisé et propagé pour les épingles TOFU ; accessibilité iOS fixée (`*_THIS_DEVICE_ONLY`) ; presse-papiers vidé 30 s après la copie du code de récupération ; épinglage de certificats prolongé (2030) et étendu à LiveKit.
- Toujours sans `REQUEST_INSTALL_PACKAGES`.

## 6. Infrastructure

Dépôt (`nginx.conf`, `docker-compose.yml`, `deploy.sh`) :
- nginx : zone API 30 r/s (rafale 100), zone dédiée `refresh` / `pwned-range`, envois de fichiers avec `limit_req` + `limit_conn 4` + `proxy_request_buffering off` (un anonyme ne peut plus remplir le disque avec des corps de 1,1 Go refusés en 401), regex statique `^(?!/api/)` (une route d'API en `.png` n'est plus un 404 statique), `img-src` en liste blanche, YouTube retiré du `script-src`.
- Compose : serveur en `read_only` + `cap_drop ALL` + `no-new-privileges` + `pids_limit` + tmpfs `/tmp` ; `no-new-privileges` + `pids_limit` sur Postgres, Redis, LiveKit.
- `deploy.sh` : `pg_dump` avant toute construction (7 sauvegardes gardées), image précédente taguée `forgechat-server:prev`, retour arrière automatique si le serveur n'est pas sain après 3 minutes.

Reste à décider par le propriétaire :
- **Garde de déploiement signé (H4)** : installer `forgechat-verify-head` + `allowed_signers` sur le VPS, ce qui impose de signer chaque commit poussé sur `main` (clé SSH de signature dédiée, par exemple rangée dans D:\MDP et utilisée par les sessions Claude).
- Signature Authenticode / notarisation des binaires de bureau.
- Expiration/rotation de la clé de signature des releases (un serveur compromis peut figer un client sur une ancienne release signée).

## 7. Vérifications

- Serveur fusionné : 315 tests unitaires + 63 tests base + 1 test de compteurs, 0 échec ; clippy `-D warnings` propre.
- Web fusionné : tsc, eslint, 50 fichiers de tests (0 échec), build.
- Desktop : `cargo check --tests`, `cargo test` 39 verts, clippy propre (Windows ; code Linux relu, non compilé localement).
- Mobile : typecheck, eslint, jest 786 tests verts.
- Pile complète locale (Postgres + Redis + serveur + scripts `client/scripts/*.api.mjs` du job CI « api ») : voir le journal de la session de publication.
