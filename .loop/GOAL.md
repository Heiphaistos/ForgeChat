# ForgeChat — CYCLE 11 (loop autonome)

## Objectif
Amélioration globale voix/vidéo :
1. 5-6 dispositions d'affichage en appel (actuellement 4 : grid/spotlight/sidebar/presentation)
2. Suppression de bruit micro améliorée (au-delà des filtres statiques highpass/lowpass/compressor actuels)
3. Caméra + partage d'écran simultanés, visibles par tous les participants, sans bug
4. Amélioration générale de l'app (bugs, UX, robustesse) — best-effort pendant le loop

## Critère de fin vérifiable
- 6 view modes fonctionnels dans VoiceVideoPage.tsx, sélectionnables, testés visuellement (build OK + gstack/dogfood si possible)
- Noise gate/expander ajouté à la chaîne noise suppression, toggle fonctionnel, pas de régression audio
- shareScreen() envoie caméra ET écran comme 2 tracks vidéo distinctes (2 transceivers), PeerTile distant affiche les deux
- `cargo check` (server) + `tsc --noEmit` (client) + `npm run build` (client) verts avant chaque déploiement
- Déployé sur VPS (docker compose up -d --build server + client build), vérifié en prod (curl/gstack)

## Périmètre — ce qu'on NE fait PAS
- Pas de dépendance externe lourde (RNNoise WASM, mediapipe, etc.) sans validation humaine — améliorer avec Web Audio API natif (AudioWorklet noise gate)
- Pas de changement d'architecture WebRTC (SFU, etc.) — rester en mesh P2P existant
- Pas d'action destructive sur données prod (DB, comptes) sans confirmation

## Bornes
- Max 10 itérations avant rapport et pause pour revue humaine
- Si même erreur de build 2x sur une feature → passer à la suivante, noter dans LESSONS.md
