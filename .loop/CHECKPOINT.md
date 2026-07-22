# CHECKPOINT

Dernière étape réussie : audio système du partage d'écran mixé au micro (commit 8337d59),
déployé automatiquement par CI Forgejo (confirmé : VPS HEAD = 8337d59), smoke test prod OK.
CYCLE 11 (demande explicite Momo) entièrement traité : 6 layouts, noise gate, caméra+écran
simultanés, mix audio système. Bascule maintenant en loop d'amélioration continue nocturne
(voir GOAL.md) — Momo est en veille, pas de supervision jusqu'à demain.

Prochaine action : itération 6 de la loop nocturne — choisir UNE piste dans GOAL.md
("Pistes candidates"), l'implémenter, vérifier, déployer (push suffit, CI Forgejo auto-déploie),
checkpoint, ScheduleWakeup suivant.

Itération CYCLE 11 : terminée (3/3 features + 1 fix limitation + 2 bugfix latents)
Itération loop nocturne : 5/8
  - it.1 : a11y switcher de disposition (commit 4b5055c, déployé confirmé)
  - it.2 : bug réel — mix audio non propagé aux peers rejoignant en cours de partage (commit 062f612, déployé confirmé)
  - it.3 : bug réel — mark_all_read (server) ignorait les échecs DB, renvoyait faux succès (commit f41549f, déployé confirmé, conteneur server rebuild+healthy)
  - it.4 : nettoyage — 7 imports inutilisés retirés (cargo fix), cargo check 0 warning (commit f211f3e, déployé confirmé, conteneur server rebuild+healthy)
  - it.5 : a11y Whiteboard (dialog role, 5 boutons outils, Escape) + Soundboard (bouton fermer, slider volume) (commit e895ea8, déployé confirmé)

Note déploiement serveur : un changement server/ déclenche un vrai rebuild Docker (cargo build),
~1-2 min, contrairement au client (quasi instantané). Pour confirmer sans deviner : capturer
`docker compose ps -q server` AVANT push, puis poller après jusqu'à ce que l'ID change (nouveau
conteneur) + health=healthy. Utiliser Bash run_in_background DIRECTEMENT sur la boucle de poll
(pas de nohup+& imbriqué). Pour un changement CLIENT seul, `git rev-parse --short HEAD` sur le
VPS suffit tout de suite (pas de rebuild Docker, juste npm ci+build côté CI).

Pistes restantes : encore d'autres modales/panneaux à auditer pour l'a11y (KeyboardShortcutsModal,
CommandPalette, StickerPicker, GifPicker — mêmes patterns probables : bouton fermer icône-seule,
pas de focus trap). Perf MessageList (1562 lignes, composant monolithique) explicitement écarté
cette nuit — trop risqué sans supervision, à proposer à Momo pour une session dédiée avec plan.
Rappel : si itération 6 OU 7 ne trouve rien de sûr, s'arrêter par GOAL.md plutôt que de forcer.

Contexte minimal pour reprendre à froid :
- Repo : C:\Users\Momo\ForgeChat (client React/Vite/TS, server Rust/Axum, VPS 212.227.140.45)
- Déploiement : push vers `main` (forgejo + github) → CI Forgejo Actions déploie automatiquement
  (.forgejo/workflows/deploy.yml, ~1-2 min). NE PAS scp manuellement (redondant, cf. LESSONS.md).
  Vérifier déploiement : `ssh root@212.227.140.45 "cd /opt/forgechat && git rev-parse --short HEAD"`
  doit matcher le dernier commit pushé.
- Build : client → `cd client && npx tsc --noEmit && npm run build` ; server → `cd server && cargo check`
- Fichiers voix/vidéo touchés ce cycle : client/src/store/voice.ts, client/src/pages/VoiceVideoPage.tsx,
  client/src/components/voice/VoiceBar.tsx, client/public/noise-gate-worklet.js
- FEATURE_BACKLOG.md tient l'historique complet des cycles précédents + règles du loop
