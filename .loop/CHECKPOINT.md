# CHECKPOINT — Loop d'amélioration continue ForgeChat

Historique détaillé itération par itération : `.loop/JOURNAL.md`. Ce fichier est un
résumé d'état à jour, élagué périodiquement (dernier élagage : 2026-07-22 19h, après
22 itérations — l'historique complet reste dans JOURNAL.md, rien n'est perdu).

## Statut actuel (2026-07-22 19:33)

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

## Fichiers encore jamais audités (pistes pour la suite)

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
