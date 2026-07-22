# ForgeChat — Loop d'amélioration continue (nuit du 2026-07-22)

## Contexte
CYCLE 11 (demande explicite Momo) terminé et déployé :
- 6 dispositions d'appel (grid/spotlight/sidebar/presentation/focus/filmstrip)
- Noise gate AudioWorklet en plus des filtres statiques
- Caméra + écran simultanés, visibles par tous (2 senders vidéo distincts)
- Audio système du partage d'écran mixé au micro (plus de perte de flux)

Momo passe en veille ("je vais me coucher") et a demandé une **loop d'amélioration continue** —
la loop doit tourner seule cette nuit, sans supervision, et s'arrêter proprement plutôt que de
divaguer indéfiniment.

## Objectif
Continuer à améliorer ForgeChat (bugs, robustesse, UX, polish) par itérations bornées,
chacune : une amélioration ciblée et vérifiable, testée (tsc + build + cargo check),
commit + push (le CI Forgejo déploie automatiquement, cf. LESSONS.md — ne PAS faire de scp manuel).

## Critère de fin (au moins UN des cas suivants)
1. 8 itérations utiles effectuées cette nuit (borne dure, cf. périmètre)
2. Un audit du code (grep patterns connus : catch vides, `.unwrap()`, TODO/FIXME, dead code,
   any manquant) ne trouve plus rien de raisonnable à corriger sans risque
3. Deux itérations de suite ne trouvent aucune amélioration sûre à faire → s'arrêter et
   rapporter plutôt que de forcer des changements cosmétiques sans valeur

## Périmètre — ce qu'on NE fait PAS cette nuit (pas de supervision humaine)
- Pas de migration DB, pas de changement de schéma
- Pas de dépendance externe nouvelle (npm install d'un nouveau package) sans nécessité forte
- Pas de suppression de feature existante
- Pas de changement d'architecture (auth, WebRTC mesh, etc.)
- Pas d'action sur données de prod (comptes utilisateurs réels, DB) — lecture seule si besoin de diagnostiquer
- Rester sur des changements localisés, testables, réversibles (fichiers modifiés < 5 par itération)

## Pistes candidates (piocher dedans, pas besoin de toutes les faire)
- Bugs latents restants dans voice.ts/VoiceVideoPage.tsx (edge cases renégociation, glare WebRTC)
- Accessibilité (aria-label manquants, contrastes, navigation clavier) sur les pages vocales/appel
- Nettoyage dead code / imports inutilisés détecté par tsc/eslint si dispo
- Petits bugs UX signalés dans FEATURE_BACKLOG.md non cochés
- Robustesse erreurs réseau (catch silencieux à vérifier — cf. règle CLAUDE.md "pas de try/catch vide")
- Perf : re-renders inutiles, mémoisation manquante sur composants lourds (MessageList, VoiceVideoPage)

## Bornes
- Max 8 itérations (au-delà : s'arrêter, checkpoint, rapport pour revue humaine au réveil de Momo)
- Si même erreur de build 2x sur une piste → l'abandonner, noter dans LESSONS.md, passer à la suivante
- Snapshot git avant modif large (déjà le cas : commit atomique par itération)
