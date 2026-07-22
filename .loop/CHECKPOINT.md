# CHECKPOINT

Dernière étape réussie : (aucune — démarrage cycle 11)
Prochaine action : implémenter 2 nouvelles dispositions (Focus + Filmstrip) dans VoiceVideoPage.tsx
Itération : 0/10
Contexte minimal pour reprendre à froid :
- Fichier principal : client/src/pages/VoiceVideoPage.tsx (ViewMode type + switch render + toolbar boutons ligne ~420)
- 4 layouts existants : grid, spotlight, sidebar, presentation
- Noise suppression : client/src/store/voice.ts _buildNoiseChain() ligne ~133 (highpass/lowpass/compressor statique, pas de gate)
- Screen share : client/src/store/voice.ts shareScreen() ligne ~717 — remplace la piste vidéo caméra par l'écran (1 seul sender vidéo) → caméra+écran pas simultanés
- Build : client → `npm run build` (Vite+tsc), server → `cargo check`
- Déploiement : voir deploy.sh / docker-compose.yml, VPS 212.227.140.45
