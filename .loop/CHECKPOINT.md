# CHECKPOINT — Loop d'amélioration continue ForgeChat

Historique détaillé itération par itération : `.loop/JOURNAL.md`. Ce fichier est un
résumé d'état à jour, élagué périodiquement (dernier élagage : 2026-07-24, après
audit web+client complet — l'historique complet reste dans JOURNAL.md, rien n'est perdu).

## Statut actuel (2026-08-04 23:00) — server 3.231.0 / client 3.572.0 / desktop 3.21.0

Header resynchronisé (était resté figé au 2026-07-24 malgré des semaines d'avancement réel — Stage channel câblé, DM_READ, fixes AppImage glibc + tray GTK Linux, voir mémoire globale `project_forgechat.md` pour le détail complet de cette période non journalisée ici). Boucle autonome en cours (cron 10min, portée web+desktop Windows+desktop Linux) : 14+ vrais fixes déployés ce jour (dont AutoMod bypass bots/webhooks/threads/forum/**scheduled messages (cycle 26)**, fuite hash bcrypt mot de passe vocal, IDOR cross-tenant category_id, race TOCTOU max_uses invitations, export RGPD tronqué à 100 messages, bypass blocage/confidentialité invite_bulk, bypass charset username, **et un message programmé qui contournait kick/ban/timeout en partant quand même à l'heure prévue (cycle 26)**) + 4 findings en attente de décision produit (RolesTab, Permissions par canal, Vérification serveur, bits bruts moderation.rs/tickets.rs) + 1 finding de durcissement technique (SSRF DNS rebinding) -- tous détaillés dans JOURNAL.md.

**Fix cycle 26 (`scheduled.rs`) vérifié en conditions réelles au cycle 27** : script Node.js de bout en bout contre la prod (comptes+serveur jetables, supprimés après) a confirmé les 2 corrections -- AutoMod bloque bien un message programmé contenant un mot interdit (400), ET un membre kické après programmation mais avant `send_at` ne voit plus son message publié par le dispatcher. Aucun signe de cache Docker menteur cette fois (image reconstruite en ~2 min après le push, timestamp cohérent).

**Fix cycle 27 (`join_server` repli sur `servers.invite_code`) vérifié en conditions réelles au cycle 28** : serveur public jetable créé, listé par `/explore`, JOIN réel réussi (200) depuis un 2e compte avec exactement le flux d'`ExplorePage.tsx`. Rejoindre un serveur public depuis Explorer/Découvrir fonctionne à nouveau en prod.

**Cycle 28 (desktop, hardening CSP)** : `script-src 'unsafe-inline'` retiré de `tauri.conf.json` (build réel + grep source ne montrent aucun besoin de script inline). Vérifié par analyse statique + `cargo check` uniquement -- PAS testé en exécution réelle (pas d'outillage navigateur automatisé dans ce repo). Sans effet tant qu'aucun nouveau build .exe/.deb/.AppImage n'est publié. Desktop 3.20.0 → 3.21.0.

## ⚠️ Fix CRITIQUE cycle 29 (`auth.rs`, révocation de session) — vérification prod EN ATTENTE

`revoke_session` était **100% cosmétique** : supprimait seulement la ligne d'affichage `user_sessions`, jamais `refresh_tokens` (table réellement consultée par `/auth/refresh`) -- pire, les deux tables ne pouvaient structurellement jamais se corréler (hash hex vs base64 du même SHA256) et `user_sessions.refresh_token_hash` n'était jamais resynchronisé après une rotation RTR. Un appareil "révoqué" gardait un accès total (refresh illimité) jusqu'à l'expiration naturelle du refresh token (30 jours). C'est la fonctionnalité qu'un utilisateur utiliserait EN PREMIER en cas de compte compromis/appareil volé, et elle ne faisait rien. **Repro confirmé en direct contre la prod AVANT le fix** (compte jetable : revoke → 204, puis refresh avec le token "révoqué" → 200 quand même). Fix : hash cohérent (`hash_token()` partout), resync de `user_sessions` à chaque refresh (bonus : `last_seen` redevient significatif), et `revoke_session` supprime vraiment la ligne `refresh_tokens` correspondante. Sessions déjà existantes en prod avant ce déploiement : no-op silencieux tant que l'utilisateur ne s'est pas reconnecté (pas un bug, juste transitoire).

**Vérifié en conditions réelles au cycle 30** : script de repro relancé après rebuild CI terminé -- revoke → 204, puis refresh avec le token de cet appareil → `401 {"error":"Non authentifié"}` (attendu). Fix confirmé actif en prod.

Finding séparé lié, PAS corrigé (changement d'architecture auth, hors périmètre autonome) : `sessions[0] = session actuelle` côté client reste un heuristique (tri par `last_seen`), pas une garantie -- le JWT ne porte aucun identifiant de session. Amélioré par ce fix (last_seen redevient fiable) mais pas rendu structurellement certain.

**Cycle 30 (client, `AuditLogPage.tsx`)** : le bouton "Charger plus" du journal d'audit ne pouvait JAMAIS s'afficher -- la requête n'envoyait aucun `limit`, donc le serveur plafonnait à 50 par défaut, et le pager client-side (qui slice sur ce même lot de 50) avait donc systématiquement `hasMore=false`. Historique au-delà des 50 dernières actions silencieusement inaccessible. Fix : `limit=200` (plafond serveur existant) ajouté à la requête. Vérifié eslint+tsc+`npm run build` complet (build WSL2 d'abord bloqué par un binaire natif `lightningcss` manquant côté Linux, environnement jamais provisionné pour WSL -- corrigé via `npm install --no-save`, aucun impact sur package.json/lock committé). **Déploiement en attente** : poussé (4fe77da), source VPS à jour, mais `version.json` affichait encore l'ancienne version à la fin du cycle -- à reconfirmer au cycle suivant.

## ⚠️ Fiabilité CI/déploiement à investiguer — cache Docker menteur, 2 occurrences dans cette session (2026-08-04, cycles 20 et 24)

Deux fois cette session, un push contenant un vrai fix serveur s'est déployé "sans erreur" (conteneur recréé, `git log` VPS à jour, `docker inspect` sur l'IMAGE avec un timestamp cohérent et récent) mais **le comportement corrigé n'était PAS présent en prod** -- seul un test fonctionnel réel contre l'endpoint l'a révélé. Dans les deux cas, un `docker compose build --no-cache server` forcé manuellement a résolu le problème immédiatement. La cause racine côté CI (`.forgejo/workflows/deploy.yml`, mécanisme `GIT_SHA` censé invalider le cache depuis le fix du 2026-07-22) n'a pas été élucidée -- ça dépasse ce qu'un cycle de loop autonome peut diagnostiquer par SSH (nécessiterait probablement de lire les logs complets d'un run Forgejo Actions concerné, voir `zstd -dc /opt/mydepot/data/gitea/actions_log/...` mentionné dans la mémoire globale). **Risque pratique** : si cette boucle autonome (ou une future session) pousse un fix serveur et ne fait PAS de test fonctionnel réel après coup (juste `git rev-parse`/`docker inspect`), il y a un risque réel et déjà matérialisé 2 fois que le fix ne soit pas réellement actif en prod malgré toutes les apparences d'un déploiement réussi. Recommandation : soit investiguer le pipeline CI en profondeur dans une session dédiée, soit accepter qu'un rebuild `--no-cache` manuel post-déploiement devienne une étape systématique pour tout fix serveur critique.

## ⚠️ Finding HAUTE SÉVÉRITÉ non corrigé — bits de permission bruts codés en dur dans 2 fichiers, dont une fuite d'info sur les tickets (2026-08-04, cycle 21)

**4e facette du même problème systémique de bits de permission**, mais cette fois pas dans RolesTab.tsx (client) -- directement dans le SERVEUR, sous forme de nombres magiques codés en dur en SQL, complètement déconnectés de l'enum `Permissions::` que `require_permission()` utilise partout ailleurs :

1. **`moderation.rs::ensure_moderator`** (gate pour mod-notes ET timeouts) : `(r.permissions & 8) <> 0 OR (r.permissions & 2147483648) <> 0`. `2147483648` = bit31 = `ADMINISTRATOR` (correct). Mais `8` = bit3 = `MANAGE_MESSAGES` -- probable confusion "bit 8" (valeur 8) vs "8e bit" (valeur 256, le vrai `MANAGE_SERVER`). Un rôle avec UNIQUEMENT "Gérer les messages" est donc traité comme modérateur habilité à voir/créer des notes de modération et des timeouts sur d'autres membres.
2. **`tickets.rs::list_tickets`** : `(r.permissions & 16384)<>0 OR sm.is_owner=true` détermine qui voit TOUS les tickets du serveur (au lieu de seulement les siens). `16384` = bit14 = `SPEAK_VOICE` -- "peut parler en vocal", une permission extrêmement banale et largement distribuée sur la plupart des serveurs, n'a AUCUN rapport logique avec la visibilité des tickets. **C'est une fuite d'information potentiellement plus grave que les 3 findings précédents** : les tickets contiennent des signalements/plaintes d'utilisateurs, potentiellement sensibles, et "Speak" est probablement l'une des permissions les plus communément accordées de tout le système de rôles.

Comparé pour confirmer que ce n'est PAS le pattern normal du projet : `uploads.rs` et `websocket.rs` (mêmes types de check bit à bit) utilisent correctement les constantes nommées `Permissions::ADMINISTRATOR`/`Permissions::PRIORITY_SPEAKER` via bind -- SEULS `moderation.rs` et `tickets.rs` ont des littéraux bruts, confirmant que c'est une erreur locale à ces 2 fichiers, pas un choix de design du projet.

**Pourquoi pas corrigé en autonome** : exactement le même raisonnement que les 3 findings ci-dessous -- changer ces bits pour pointer vers les vraies constantes (probablement `MANAGE_SERVER`=256 pour les deux, à confirmer avec Momo) modifie un comportement d'accès réel pour tout rôle déjà configuré sur un serveur existant (qui pourrait perdre ou gagner l'accès aux tickets/mod-notes selon ses bits actuels). À traiter dans LA MÊME session que la décision de remap RolesTab -- c'est un symptôme de plus du même problème racine (aucune source de vérité unique pour la signification des bits dans ce projet), pas un bug isolé à corriger séparément.

## ⚠️ Finding NON corrigé — feature "Permissions par canal" 100% placebo, jamais appliquée (2026-08-04, cycle 6)

`ChannelSettingsModal.tsx` (onglet Permissions) laisse un admin configurer des overrides allow/deny par rôle ou par membre POUR UN CANAL DONNÉ (ex. rendre un canal privé en refusant VIEW_CHANNEL à @everyone). Ces valeurs sont bien sauvegardées (`PUT /channels/:id/permissions/:target_id` → table `channel_permissions`, confirmé par lecture de `channels.rs::put_channel_permission`) et bien réaffichées (`GET .../permissions`). **Mais `channel_permissions` n'est JAMAIS lue nulle part ailleurs dans tout le serveur** (grep exhaustif `channel_permissions` sur `server/src` : seulement les 3 sites CRUD, zéro consultation) — `require_member_and_channel()` (le seul gate utilisé pour voir/poster dans un canal) vérifie uniquement l'appartenance au SERVEUR + que le canal existe, jamais les overrides du canal. Un admin qui pense avoir rendu un canal privé via cet onglet ne restreint RIEN en réalité : tous les membres du serveur gardent un accès complet, silencieusement. Pas une faille d'escalade (rien de PIRE que l'état actuel ne peut arriver), mais un vrai gap de contrôle d'accès si un admin s'appuie dessus pour la confidentialité d'un canal.

**Pourquoi pas corrigé en autonome** : contrairement aux fixes de ce cycle, une vraie correction ne tient pas dans un patch minimal -- il faut construire une fonction de résolution de permission effective (base rôle+@everyone, puis overlay des overrides canal par rôle, puis override canal par membre -- ordre Discord standard) et la brancher dans TOUS les points d'accès canal (get_messages/send_message/etc, pas juste un endroit). Ça change un comportement d'accès réel pour tout serveur ayant déjà configuré des overrides (probablement rare vu que la feature n'a jamais eu d'effet, mais inconnu sans vérifier la prod). De plus les bits envoyés par le client (`CHANNEL_PERMISSION_BITS`) suivent le MÊME référentiel que RolesTab.tsx (client, désaligné du serveur, cf. finding ci-dessus) -- donc une vraie correction de cette feature doit être coordonnée avec la décision de remap déjà en attente, pas traitée séparément. À décider avec Momo en même temps que le finding RolesTab.

## ⚠️ Finding NON corrigé — "Vérification requise" (règles serveur) jamais appliquée non plus (2026-08-04, cycle 11)

Même famille que le finding "Permissions par canal" ci-dessus, 3e instance du même pattern trouvée cette session. `VerificationGateModal.tsx` fait accepter les règles d'un serveur (`POST /servers/:id/verify` → `server_members.verified_at`), mais **`verified_at` n'est JAMAIS vérifié nulle part** dans les gates d'accès aux canaux (grep exhaustif : seulement écrit par `verify_member`, relu uniquement pour l'affichage côté client, jamais consulté par `require_member`/`require_member_and_channel`). Un membre qui rejoint un serveur avec vérification activée peut lire/envoyer des messages, rejoindre le vocal, etc. sans jamais avoir accepté les règles -- le gate est 100% cosmétique côté client, contournable simplement en n'appelant jamais `/verify` (ou en appelant directement les endpoints de canal).

**Pourquoi pas corrigé en autonome, contrairement aux autres fixes de ce cycle** : ce fix serait techniquement CONTENU (une seule condition à ajouter dans `require_member_and_channel`, pas besoin de construire un nouveau moteur comme pour les overrides canal) mais il **change un comportement d'accès réel immédiatement pour tout membre déjà rejoint mais non-vérifié sur un serveur ayant `verification_enabled=true` en prod aujourd'hui** -- contrairement aux autres fixes de cette session (IDOR cross-tenant, race invitations, fuite de hash) qui n'avaient AUCUN cas d'usage légitime dépendant du comportement cassé, ici un déploiement immédiat pourrait bloquer des membres légitimes déjà actifs sans prévenir personne. Inconnu sans interroger la prod si un serveur réel utilise cette feature aujourd'hui. Fix recommandé si Momo confirme vouloir l'activer : ajouter le check `verification_enabled && verified_at IS NULL → Forbidden` dans `require_member_and_channel` (message clair invitant à vérifier d'abord), + vérifier séparément le chemin WS `VOICE_JOIN` (check inline différent, pas passé par cette fonction partagée).

## ⚠️ Finding HAUTE SÉVÉRITÉ non corrigé — nécessite décision Momo AVANT tout fix (2026-08-04, CORRIGÉ au cycle 3 par test live réel)

**Correction importante par rapport à l'entrée d'origine (cycle 1)** : la partie "ADMINISTRATOR total via checkbox" a été **testée en direct contre la prod (compte+serveur jetables, supprimés après) et INFIRMÉE** — `create_role`/`update_role` (`server/src/handlers/roles.rs` lignes 77-78 et 121-122) masquent `body.permissions` avec `& 0x3FFFF` (bits 0-17 uniquement) AVANT insertion en DB, ce qui élimine bien le bit 31 (ADMINISTRATOR) et bit 18 (PRIORITY_SPEAKER, du coup jamais assignable non plus, bug séparé mineur). Testé : `permissions: 2147483680` (bit31+bit5) envoyé → `32` stocké (bit31 disparu). Le scénario "coche une case anodine → deviens admin total" **n'est PAS exploitable**.

**Ce qui RESTE un vrai bug confirmé (testé en direct, pas juste lu dans le code)** : à l'intérieur des bits 0-17 (non filtrés par le masque), le bitmask client (`RolesTab.tsx`) reste totalement désaligné du bitmask serveur (`server/src/models/role.rs::Permissions`), et plusieurs collisions DANGEREUSES persistent, ex. confirmé par test réel : cocher uniquement "Gérer les emojis & stickers" (client bit5, valeur 32) → stocké tel quel → le serveur lit son propre bit5 = **MANAGE_ROLES** (`require_permission` accepterait cette valeur pour gérer les rôles). Par le même mécanisme (même masque, mêmes bits <18, pas testés un par un mais même logique) : "Gérer les webhooks"→MANAGE_CHANNELS(serveur), "Gérer les événements"→BAN_MEMBERS(serveur), "Créer des événements"→MANAGE_SERVER(serveur), "Gérer les bots"→KICK_MEMBERS(serveur), "Voir les statistiques"→MANAGE_MESSAGES(serveur). Donc pas de prise de contrôle totale, mais des cases à cocher d'apparence anodine peuvent accorder bannissement/expulsion/gestion serveur/gestion des rôles/gestion des salons — sévérité HAUTE, pas CRITIQUE.

Détail complet, méthode de test (comptes+serveur jetables via l'API réelle, nettoyés après), table de collision et 2 options de fix (avec recommandation) dans `.loop/JOURNAL.md` entrées `[2026-08-04T14:10:00]` (finding initial) et `[2026-08-04T14:40:00]` (correction + preuve live). **Pourquoi toujours pas corrigé en autonome** : le fix change la signification des valeurs déjà stockées dans `roles.permissions` en prod pour tout rôle personnalisé existant (discontinuité UX + décision d'architecture sur données réelles) — attend l'accord explicite de Momo, pas un fix unilatéral en cycle cron non supervisé.

## Statut précédent (2026-07-24 15:20) — server 3.178.0 / client 3.525.0 / desktop 3.8.2

Audit complet web (server handlers jamais touchés + pages/modals client jamais relues).
**6 bugs réels trouvés et corrigés, tous déployés+vérifiés en prod** :
1. `bots.rs`/`messages.rs` — `dispatch_slash_command` jamais appelé depuis `send_message` :
   les slash commands de bot enregistrées ne faisaient jamais rien. Fix : appel ajouté
   après le broadcast MESSAGE_CREATE. Commit 6463887.
2. `servers.rs` `get_admin_stats` renvoyait `total_members`, `AdminPage.tsx` attendait
   `total_users` → carte "Utilisateurs" toujours à 0. Vérifié live (`total_users:1`).
3. Activity feed (`users.rs get_activity_feed`) ne générait jamais `friend_join_server` →
   filtre "Amis" de `ActivityFeedPage` en permanence vide. Ajouté (exclut les doublons de
   la requête générique server_join).
4. **Webhooks 100% cassés depuis leur création (v2.3.0)** : `create_webhook` masquait le
   token même dans SA PROPRE réponse → l'URL webhook n'était jamais récupérable via l'UI,
   ni à la création ni après. Fix : token complet renvoyé une fois à la création (pattern
   reveal-once déjà utilisé pour les bots), masqué partout ailleurs. Vérifié live end-to-end.
5. `get_server_stats` ne renvoyait pas `channel_count` et renvoyait
   `message_count_today`/`week` au lieu de `message_count` → 2 cartes sur 4 de l'onglet
   Stats (ServerSettingsModal) toujours à "—". Fix serveur (ajout channel_count) + client
   (câblé sur les vrais champs). Vérifié live.
6. **Régression réelle trouvée par la suite E2E, pas par l'audit statique** :
   `client/src/store/voice.ts` `camSender()` — le fallback `track === null` pour réutiliser
   un sender caméra matchait AUSSI le sender recvonly auto-créé par le navigateur quand on
   reçoit la caméra du pair AVANT d'avoir activé la sienne. `replaceTrack()` dessus ne
   renégocie jamais et un transceiver recvonly n'envoie jamais → caméra bidirectionnelle
   cassée en silence (aperçu local OK des deux côtés, mais le pair ne reçoit rien). Confirmé
   par wrapper RTCPeerConnection (zéro event côté receveur). Fix : `_camSenders` map dédiée
   (même pattern que `_screenSenders` déjà existant) au lieu de deviner par track===null.
   Commit f4ef443, client 3.525.0. **Suite E2E complète re-passée 6/6 après ce fix**
   (dmcall, screenshare, camera, glare, missedcall, camscreen).

**Non corrigé, signalé, pas un bug de cette session** : 3 alertes Dependabot modérées sur
GitHub — react-router 6.30.4 (dernière 6.x) reste vulnérable (CVE-2025-68470 + GHSA-337j),
fix seulement via bump majeur 6→7 (breaking, React Router v7 change beaucoup — à faire en
session dédiée avec accord explicite, pas dans cette loop).

**VM Hyper-V** : redémarrée à froid ce jour (l'état sauvegardé refusait de reprendre —
disque système à ~9.5 Go libres, le fichier mémoire de reprise (.VMRS) en demandait 16-18
Go). Mémoire de démarrage réduite 16→4 Go (dynamique, min 512 Mo, fonctionne) pour tenir
dans l'espace dispo — VM tourne. Momo reprend les tests manuellement (repro bug #4 image
OBS fantôme + validation du fix caméra bidirectionnelle en conditions réelles desktop) ;
pas de nouveau build desktop nécessaire, aucun changement natif cette session (desktop
= webview pointant sur forgechat.heiphaistos.org, hérite des fixes web automatiquement).

⚠️ **Espace disque système bas (~9.5 Go libres avant réduction mémoire VM)** — à surveiller,
pourrait re-bloquer d'autres VM ou opérations disque bientôt.

## Statut précédent (2026-07-22 19:33) — pour référence

**Itération post-réparation** : webhooks.rs audité (jamais touché avant). list/create/
delete_webhook propres. BUG RÉEL trouvé : execute_webhook comparait le token webhook
via `WHERE token=$2` en SQL (memcmp non temps-constant), alors que
verify_github_token_get (même fichier) utilise déjà une comparaison XOR-fold temps
constant pour SON token — incohérence corrigée (fetch par id seul + comparaison Rust
temps constant, même pattern). Commit 5d38da7, server 3.174.0. Déploiement auto
confirmé fonctionnel (HEAD VPS + /health 200 sans intervention manuelle).

**Déploiement RÉPARÉ** — CI Forgejo Actions déploie de nouveau automatiquement à
chaque push (git reset + npm ci + build + docker compose up --build). Vérifié
fonctionnel sur plusieurs déploiements consécutifs sans intervention manuelle. Voir
`project_forgechat.md` (mémoire globale) section "Loop 2026-07-22" pour le détail des
2 causes racines (lockfile npm11/npm10 + cache Docker menteur) et leurs fixs durables.

**server v3.173.0 / client v3.518.0 / desktop v3.7.0** (publiée et téléchargeable).

**22 itérations menées, ~15 vrais bugs trouvés+fixés**, tous en production. Refactor
MessageList→MessageRow (b44fd8d) : spot-check humain toujours non confirmé par Momo,
mais 2 relectures fraîches (it.8, it.21 zone useDmCall) n'ont rien trouvé de cassé
d'autre — traiter comme sain sauf signal contraire.

## Pistes déjà épuisées (ne pas re-creuser sans nouvelle piste précise)

- **`let _ =`/`.ok()` avalant des erreurs côté serveur** : tout `server/src/handlers/`
  audité (websocket.rs, users.rs, friends.rs, emojis.rs, stickers.rs, main.rs,
  scheduled.rs, call_history) — sites restants tous bénins (best-effort, idempotents,
  ou déjà protégés par transaction). 6 vrais bugs déjà fixés sur cette veine
  (audit_log x2, group_dms ghost, feeds.rs, reminders, — voir JOURNAL.md it.11-13).
- **Mojibake / corruption d'encodage** : grep élargi (Latin-1, Windows-1252, NBSP
  isolé) sur tout `server/src` + `client/src` — seuls threads.rs/forum.rs étaient
  touchés (fixés it.15), rien ailleurs.
- **IDOR/ownership audité et propre** : group_dms.rs (16 handlers), whiteboard WS,
  VOICE_STATE, polls.rs, reports.rs, moderation.rs, uploads.rs, privacy.rs,
  dm_extras.rs, search.rs, user_settings.rs (591L), templates.rs. 2 vrais trous
  trouvés+fixés (tickets.rs it.17, saved.rs it.18).
- **Fichiers client hooks/store audités** : auth.ts, presence.ts, channelNotif.ts,
  useVoiceActivity.ts, api/client.ts — propres sauf api/client.ts (fixé it.20).

## Audité 2026-07-24 (à ne pas re-creuser sans piste précise)

Serveur : stickers.rs, server_settings.rs (bans/tags/membres détaillés), invites.rs,
bots.rs, webhooks.rs (revalidé), soundboard.rs — tous propres sauf les 5 bugs listés
au-dessus. Client : AdminPage, ExplorePage, ActivityFeedPage, LeaderboardPage,
TicketsPage, WebhooksTab, TagsTab, BansTab, StatsTab, AuditLogTab.

**Liste du 2026-07-24 -- TOUS AUDITÉS PENDANT LA BOUCLE DU 2026-08-04 (cycles 1-19), ne pas re-creuser sans piste précise** :
ChannelSettingsModal.tsx (cycle 6, IDOR category_id cross-tenant trouvé+fixé côté serveur),
ServerSettingsModal.tsx (cycle 8, icône non réinitialisée après échec upload, fixé),
RolesTab.tsx (cycle 1/3, finding permissions HAUTE, voir plus haut), InviteModal.tsx
(cycle 10, race TOCTOU max_uses, fixé+vérifié live), FeedsTab.tsx (cycle 12, gap SSRF
DNS rebinding noté, pas fixé), AutoModTab.tsx (cycle 4, filtre substring→mot entier,
fixé), CreateChannelModal.tsx (cycle 9, même IDOR category_id que ChannelSettingsModal),
ImportContactsModal.tsx (cycle 14, invite_bulk bypass blocage/confidentialité, fixé+
vérifié live), ServerTemplateModal.tsx (cycle 17, categories déclarées mais jamais
utilisées, mineur pas fixé), MembersTab.tsx (cycle 3, propre), NicknameModal.tsx (cycle
18... en fait cycle 16, broadcast WS manquant, fixé+vérifié via vrai client WebSocket),
ChannelNotifModal.tsx (cycle 18, level "all" jamais consulté, fixé), UserProfileModal.tsx
(cycle 15, bypass charset username via édition profil, fixé+vérifié live),
VerificationGateModal.tsx (cycle 11, finding enforcement jamais câblé, voir plus haut),
VoicePasswordPrompt.tsx (cycle 7, fuite hash bcrypt via GET channels, fixé+vérifié live).
Desktop : lib.rs+capabilities (cycle 2), build.bat+build.sh (cycle 5, version hardcodée),
build Linux réel vérifié de bout en bout (cycle 17), build Windows en cours de
vérification (cycle 19).

## Fichiers encore jamais audités (pistes pour la suite, historique pré-2026-07-24)

**`client/src/hooks/` : AUDIT COMPLET, ÉPUISÉ (2026-07-22 19h)** — 16/16 fichiers
relus (useAudioNotifications, useCaptions, useCountdown, useDmCall, useE2E*,
useEscapeKey, useFormatDate, useIntersection, useKeyboardNav, usePageTitle,
usePushNotifications, useSwipeClose, useTypeToFocus, useUpdateNotifier,
useVoiceActivity, useWakeLock — *useE2E.ts pas encore lu en détail, seul restant
possible). 2 vrais bugs trouvés (useDmCall it.21, useCaptions it.22), le reste propre.
Ne PAS re-auditer sans piste précise. Note DRY (pas un bug) : `useFormatDate.ts` et
la logique locale de `MessageList.tsx` dupliquent presque le même formatTs — jamais
divergent, juste dupliqué, pas prioritaire.

Côté serveur (jamais touchés cette session) : stickers.rs, server_settings.rs,
invites.rs, bots.rs, webhooks.rs, soundboard.rs (audité historiquement cycle 6, pas
cette session — revalider).
Côté client (jamais touchés cette session) : composants `settings/*` (au-delà a11y),
composants `modals/*` (logique, pas juste a11y déjà fait), `pages/*` non encore
relues (AdminPage, ExplorePage, ActivityFeedPage, LeaderboardPage, TicketsPage...).

## Finding NON corrigé — nécessite validation humaine avant d'y toucher

**Race potentielle de renégociation WebRTC dans `client/src/store/voice.ts`.**
`toggleVideo`/`shareScreen`/`stopScreenShare` appellent chacun `createOffer()` +
`setLocalDescription()` sans mutex/queue par `RTCPeerConnection`. 2 actions coup sur
coup pourraient théoriquement casser la négociation pour cette paire. Jamais reproduit
en prod, identifié par lecture de code. Fix propre = file d'attente de renégociation
par pc. **Ne pas corriger sans l'accord de Momo** — surface large, risque de casser la
voix/vidéo en prod si mal fait.

## Contexte technique (stable, ne change pas d'une itération à l'autre)

- Repo : `C:\Users\Momo\ForgeChat` (client React/Vite/TS, server Rust/Axum, VPS
  212.227.140.45). Remotes : `forgejo` (mydepot.heiphaistos.org, déclenche le CI) +
  `github` — toujours pousser main ET main:master sur les deux.
- Déploiement : push → CI Forgejo Actions auto (`.forgejo/workflows/deploy.yml`).
  Vérifier après un push important : `curl https://forgechat.heiphaistos.org/version.json`
  et `ssh root@212.227.140.45 "cd /opt/forgechat && git rev-parse --short HEAD"`.
- Build local : client → `cd client && npx eslint src && npx tsc --noEmit && npm run
  build` ; server → `cd server && cargo check`. Après tout bump de version.toml,
  relancer `cargo check` pour resync Cargo.lock avant de committer.
- Version : incrémenter client/package.json ET server/Cargo.toml à chaque itération
  qui les touche (patterns déjà établis, voir JOURNAL.md).
- `.loop/LESSONS.md` : leçons opérationnelles (déploiement, WebRTC, CI, npm/Docker).
  Toujours lire avant de commencer une itération.
