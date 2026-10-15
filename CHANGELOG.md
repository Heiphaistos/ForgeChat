# Journal des modifications

## Bureau 3.32.0 / client 3.602.0

- Mises à jour du bureau signées : aucune mise à jour n'est installée sans la signature Ed25519 de
  `SHA256SUMS.txt` (clé privée hors ligne, clé publique intégrée à l'application). Le SHA-256 du binaire
  téléchargé est comparé à la ligne signée, l'URL doit venir de `https://forgechat.heiphaistos.org/desktop/`
  et le nom du fichier doit porter la version annoncée (pas de retour en arrière). Un serveur compromis ne
  peut plus servir un binaire piégé avec son empreinte.
- Réglages > Avancé > Mises à jour : bouton « Rechercher une mise à jour » et réglage
  « Vérifier les mises à jour automatiquement » (actif par défaut).
- Publication : chaque release bureau doit être signée avec `scripts/release-sign.mjs`
  (procédure dans `docs/PUBLICATION-SIGNEE.md`) et le serveur doit publier
  `desktop-vX.Y.Z.SHA256SUMS.txt` et son `.sig` dans `/desktop/`. Sans cela, les mises à jour sont refusées.
