# CHECKPOINT

Dernière étape réussie : itération 1 déployée en prod (commit 7a57109, push forgejo+github, VPS resync client/dist propre, smoke test 200 OK)
Prochaine action : passe qualité générale (bug hunt UX résiduel) + vérifier robustesse getDisplayMedia (partage fenêtre/onglet/écran entier) en conditions réelles 2 pairs si possible
Itération : 1/10
Contexte minimal pour reprendre à froid :
- 6 layouts en place : grid/spotlight/sidebar/presentation/focus/filmstrip (VoiceVideoPage.tsx, ViewMode type ligne ~23)
- Système de tuiles : allTiles (peer → 1 tuile caméra + 1 tuile écran si screenStream actif), renderTile() dispatch PeerTile/ScreenTile
- Noise gate : client/public/noise-gate-worklet.js (AudioWorklet), chargé via _ensureNoiseWorklet() dans voice.ts, chaîne highpass→lowpass→gate→compressor→gain
- Caméra+écran simultanés : voice.ts _screenSenders Map (peerId→RTCRtpSender dédié écran), _camStreamId Map (peerId→msid du groupe caméra+micro) pour que pc.ontrack distingue caméra vs écran sans signalisation supplémentaire
- Limitation connue non résolue : audio système du partage d'écran non envoyé (juste stoppé) — mentionné FEATURE_BACKLOG.md CYCLE 11, à traiter si demandé explicitement (mix audio micro+système = complexité supplémentaire, pas dans le scope initial)
- Déploiement : scp dist/* → VPS /opt/forgechat/client/dist/ (PAS de --delete natif, faire un rm -rf assets/* avant re-copie sinon accumulation de chunks stales), puis /opt/forgechat/deploy-client.sh (juste chmod). Pas de rebuild Docker nécessaire si server/ non touché.
- Build : client → npx tsc --noEmit puis npm run build ; server → cargo check (aucun changement server ce cycle)
