# CHECKPOINT

Dernière étape réussie : audio système du partage d'écran mixé au micro (commit 8337d59),
déployé automatiquement par CI Forgejo (confirmé : VPS HEAD = 8337d59), smoke test prod OK.
CYCLE 11 (demande explicite Momo) entièrement traité : 6 layouts, noise gate, caméra+écran
simultanés, mix audio système. Bascule maintenant en loop d'amélioration continue nocturne
(voir GOAL.md) — Momo est en veille, pas de supervision jusqu'à demain.

Prochaine action : itération 2 de la loop nocturne — choisir UNE piste dans GOAL.md
("Pistes candidates"), l'implémenter, vérifier, déployer (push suffit, CI Forgejo auto-déploie),
checkpoint, ScheduleWakeup suivant.

Itération CYCLE 11 : terminée (3/3 features + 1 fix limitation + 2 bugfix latents)
Itération loop nocturne : 1/8 (a11y switcher de disposition, commit 4b5055c, déployé confirmé)

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
