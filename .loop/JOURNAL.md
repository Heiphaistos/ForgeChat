# JOURNAL

[2026-07-22T00:00:00] Démarrage CYCLE 11 → GOAL.md + CHECKPOINT.md créés, backlog analysé (ok)
[2026-07-22T00:50:00] Itération 1 : 2 layouts (Focus/Filmstrip) + noise gate AudioWorklet + caméra/écran simultanés (refonte senders vidéo voice.ts) + 2 bugfix latents (VoiceBar icône caméra, toggleVideo sender dupliqué) → tsc clean, cargo check clean, npm run build OK, déployé VPS (client dist resync propre), smoke test prod 200 sur /, bundle JS et noise-gate-worklet.js (ok, preuve : curl 200 sur les 3)
[2026-07-22T01:00:00] Traitement limitation connue : audio système du partage d'écran mixé au micro (Web Audio graph) au lieu d'être perdu/remplacer le micro → tsc clean, build OK, commit 8337d59 pushé forgejo+github (ok)
[2026-07-22T01:02:00] Découverte : CI Forgejo Actions (.forgejo/workflows/deploy.yml) déploie déjà automatiquement sur push main — scp manuel précédent redondant. Vérifié VPS HEAD=8337d59 après push (ok, preuve : git rev-parse sur VPS)
[2026-07-22T01:05:00] Momo se couche, demande "traite tout + crée une loop d'amélioration". CYCLE 11 explicite entièrement traité → GOAL.md/CHECKPOINT.md basculés en mode loop nocturne, bornée à 8 itérations, périmètre sûr défini (pas de DB/archi/prod)
[2026-07-22T01:10:00] Loop nocturne itération 1 : a11y switcher de disposition (aria-label + aria-pressed + role=group, 6 boutons icône-seule sans nom accessible) → tsc clean, build OK, commit 4b5055c pushé, CI Forgejo a déployé tout seul (vérifié : VPS HEAD=4b5055c) (ok)
