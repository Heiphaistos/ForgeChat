# CHECKPOINT — Loop d'amélioration continue ForgeChat

Historique détaillé itération par itération : `.loop/JOURNAL.md`. Ce fichier est un
résumé d'état à jour, élagué périodiquement (dernier élagage : 2026-07-24, après
audit web+client complet — l'historique complet reste dans JOURNAL.md, rien n'est perdu).

## Statut actuel (2026-08-04 14:10) — server 3.218.0 / client 3.567.0 / desktop 3.19.0

Header resynchronisé (était resté figé au 2026-07-24 malgré des semaines d'avancement réel — Stage channel câblé, DM_READ, fixes AppImage glibc + tray GTK Linux, voir mémoire globale `project_forgechat.md` pour le détail complet de cette période non journalisée ici). Reprise de la boucle autonome (cron 10min, portée web+desktop Windows+desktop Linux).

## ⚠️ Finding CRITIQUE non corrigé — nécessite décision Momo AVANT tout fix (2026-08-04)

**Le bitmask de permissions envoyé par `RolesTab.tsx` (client) n'a AUCUN rapport avec les bits vérifiés par `require_permission()` côté serveur.** Conséquence la plus grave : cocher "Commandes d'application" (USE_APPLICATION_CMDS, bit client 31, catégorie anodine "Salons texte") envoie exactement le bit que le serveur interprète comme ADMINISTRATOR (bypass total) — un rôle low-trust peut se voir accorder les pleins pouvoirs serveur par une case à cocher qui n'a l'air de rien. Aucune des ~19 permissions partagées par le nom (Kick/Ban/Manage Roles/Manage Channels/...) ne fait ce qu'elle prétend non plus (bits totalement différents des deux côtés). Détail complet, table de collision, analyse d'exploitabilité et 2 options de fix (avec recommandation) dans `.loop/JOURNAL.md` entrée `[2026-08-04T14:10:00]`. **Pourquoi pas corrigé en autonome** : le fix change la signification des valeurs déjà stockées dans `roles.permissions` en prod pour tout rôle personnalisé existant (discontinuité UX + décision d'architecture sur données réelles) — attend l'accord explicite de Momo, pas un fix unilatéral en cycle cron non supervisé.

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

**Encore jamais audités niveau logique (modals volumineux, pistes pour la suite)** :
ChannelSettingsModal.tsx (632L), ServerSettingsModal.tsx (804L, au-delà des sections
bots/stats déjà vérifiées par ce passage), RolesTab.tsx (529L), InviteModal.tsx,
FeedsTab.tsx, AutoModTab.tsx, CreateChannelModal.tsx, ImportContactsModal.tsx,
ServerTemplateModal.tsx, MembersTab.tsx, NicknameModal.tsx, ChannelNotifModal.tsx,
UserProfileModal.tsx, VerificationGateModal.tsx, VoicePasswordPrompt.tsx.

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
