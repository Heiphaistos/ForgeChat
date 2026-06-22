# ForgeChat — Feature Backlog (Loop d'amélioration autonome)

> Format : `- [ ] PRIORITÉ — Feature — Fichiers impactés`
> Priorités : 🔴 CRITIQUE | 🟠 HAUTE | 🟡 MOYENNE | 🟢 BASSE
> Marquer `[x]` une fois implémenté + date

---

## CYCLE 1 (2026-06-22 ✅)

- [x] 🔴 Backend — `GET /api/servers/discover` + `GET /api/activity-feed` — déployé VPS 09:30
- [x] 🔴 Backend — `GET/POST /api/servers/:s/channels/:c/polls/:id` — polls handler existant
- [x] 🔴 Backend — `PATCH /api/user/status` — update statut + broadcast PRESENCE_UPDATE

## CYCLE 2 (2026-06-22 ✅)

- [x] 🟠 Frontend — ThreadPanel WS realtime, scroll auto, label vide
- [x] 🟠 Frontend — Reactions: picker 20 emojis, toggle add/remove, WS REACTION_ADD/REMOVE
- [x] 🟠 Frontend — Channel mention # autocomplete, keyboard nav

## CYCLE 3 (2026-06-22 ✅)

- [x] 🟠 Frontend — Channel categories collapse/expand persisté localStorage
- [x] 🟠 Frontend — Rich text toolbar (B/I/~~/code/block/quote/lien + Ctrl+B/I/K)
- [x] 🟠 Frontend — Code blocks stylisés bg-[#1e1f29] + header langue

## CYCLE 4

- [ ] 🟡 Frontend — Message bookmarks — icône bookmark sur les messages, page `/saved` enrichie
- [ ] 🟡 Frontend — Rich text editor basique dans MessageInput (bold, italic, code, strikethrough avec markdown)
- [ ] 🟡 Frontend — Code blocks avec coloration syntaxique (highlight.js ou prism)

## CYCLE 5

- [ ] 🟡 Frontend — Server boost UI (cosmétique, sans paiement) — banner animée, badge membre
- [ ] 🟡 Frontend — User achievements/badges système
- [ ] 🟡 Backend — `GET/POST /api/servers/:id/stickers` — stickers custom par serveur

## CYCLE 6

- [ ] 🟡 Frontend — Kanban view pour `channel_tasks` (AuditLogPage déjà là, mais pas de Kanban)
- [ ] 🟡 Frontend — Calendar view pour `ServerEventsPage` (vue mensuelle avec `react-calendar` ou CSS pur)
- [ ] 🟡 Backend — Push notifications browser (service worker + Web Push API)

## CYCLE 7

- [ ] 🟢 Frontend — Drag & drop pour réordonner les channels dans la sidebar
- [ ] 🟢 Frontend — Drag & drop pour réordonner les serveurs dans la liste gauche
- [ ] 🟢 Frontend — Quick emoji reactions (double-clic sur message → 5 emojis fréquents)

## CYCLE 8

- [ ] 🟢 Frontend — Profile banners custom (upload image, crop)
- [ ] 🟢 Frontend — Animated GIF avatars (autoplay dans les messages, static en sidebar)
- [ ] 🟢 Backend — Image resizing/thumbnail pour avatars (sharp ou imagemagick)

## CYCLE 9

- [ ] 🟢 Frontend — Keyboard navigation complète (Tab entre panneaux, flèches dans listes)
- [ ] 🟢 Frontend — Zoom accessibilité (Ctrl+/Ctrl- modifie CSS var --zoom)
- [ ] 🟢 Frontend — Mode compact ultra (densité messages type Slack)

## CYCLE 10

- [ ] 🟢 Frontend — Export conversation en PDF/TXT
- [ ] 🟢 Frontend — Import contacts (CSV) pour invitations en masse
- [ ] 🟢 Backend — Webhook entrant (POST URL → message dans canal)

---

## Déjà implémenté (ne pas redéployer)

- [x] PollDisplay (frontend, pas de backend — CYCLE 1 doit créer le backend)
- [x] GifPicker (Tenor, existait déjà)
- [x] ForwardModal (existait déjà)
- [x] LinkPreview (existait déjà)
- [x] Scheduled messages UI (existait déjà)
- [x] Soundboard (frontend + backend)
- [x] StageChannel UI
- [x] VoiceActivityBar
- [x] ServerEventsPage
- [x] AuditLogPage
- [x] AutoModPage
- [x] ServerStatsPage
- [x] CommandPalette (Ctrl+K)
- [x] ServerDiscoveryPage (/discovery)
- [x] DMConversation (read receipts + typing indicator)
- [x] UserProfileCard
- [x] ActivityFeedPage (/activity)
- [x] SettingsPage refactorisée (8 composants)
- [x] 2026-06-22 — Cycle 0 : mega expansion initiale

---

## Règles du loop

1. Prendre les 3 premières features `[ ]` du prochain CYCLE non terminé
2. Implémenter via agents parallèles si indépendant
3. `cargo check` + `tsc --noEmit` avant deploy
4. `npm run build` + SCP + `chmod -R 755` + `docker compose up -d --build server`
5. Marquer `[x]` + date dans ce fichier
6. Commit + push origin master
7. ScheduleWakeup pour le prochain cycle (délai : 270s si actif, 1200s si idle)
