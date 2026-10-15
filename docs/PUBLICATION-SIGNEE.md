# Publication signée des applications (desktop, mobile)

> Copie de la procédure du dépôt principal. Dans ce clone, seuls le bureau, `scripts/release-sign.mjs` et la clé publique existent : `forgechat_releases_sync.py` (VPS) et l'app mobile n'y figurent pas. Le VPS doit publier `desktop-vX.Y.Z.SHA256SUMS.txt` et son `.sig` dans `/desktop/` avant qu'une mise à jour soit acceptée.

Depuis l'audit du 2026-10-10 (H4), une release n'est installée par les applications que si son
`SHA256SUMS.txt` est signé par la clé Ed25519 de ForgeChat. Cette clé est **hors ligne** : ni sur
GitHub, ni sur le VPS.

| Élément | Emplacement |
|---|---|
| Clé privée | `D:\MDP\forgechat-release-signing\private.pem` (jamais dans le dépôt, à sauvegarder hors ligne) |
| Clé publique | `deploy/release-signing-public.pem` ; recopiée dans `deploy/forgechat_releases_sync.py`, `desktop/src-tauri/src/updater.rs`, `mobile/src/features/updates/releaseKey.ts` |
| Empreinte SHA-256 de la clé publique | `e43061229a0116ef3f024c6b72fa26bb9e74c01834782e9f3229cf154ae7c2b6` |
| Script | `scripts/release-sign.mjs` (Node ≥ 18, aucune dépendance) |

## Chaîne de confiance

1. Tag `desktop-vX.Y.Z` ou `mobile-vX.Y.Z` → la CI construit (jobs en lecture seule) et le job
   `release` crée une release **brouillon, pré-version**, avec les binaires et `SHA256SUMS.txt`.
2. Sur ce PC : téléchargement des fichiers, **vérification de chaque empreinte**, signature de
   `SHA256SUMS.txt`, envoi de `SHA256SUMS.txt.sig`.
3. Publication de la release. Le VPS (`forgechat_releases_sync.py`, toutes les 5 min) refuse toute
   release sans signature valide, puis copie `desktop-vX.Y.Z.SHA256SUMS.txt` (+ `.sig`) ou
   `mobile-vX.Y.Z.SHA256SUMS.txt` (+ `.sig`) à côté des binaires.
4. Les applications téléchargent ces deux fichiers, vérifient la signature avec la clé publique
   embarquée et exigent que l'empreinte du fichier soit celle de la ligne signée.
   - Bureau : vérifie aussi le binaire téléchargé avant de l'installer.
   - Mobile : l'APK est téléchargé par le navigateur, l'app ne peut pas le hacher ; elle refuse de
     proposer la mise à jour si l'empreinte annoncée n'est pas celle de la liste signée. Android
     refuse ensuite tout APK signé par une autre clé que l'app installée.

## Procédure (à chaque release)

```bash
TAG=desktop-v3.55.0            # ou mobile-v1.28.0
D="$HOME/forgechat-sign/$TAG"
rm -rf "$D" && mkdir -p "$D"

# 1. Télécharger TOUS les fichiers de la release brouillon
gh release download "$TAG" --repo Heiphaistos/ForgeChat --dir "$D"

# 2. Vérifier puis signer (refuse si un fichier listé manque ou ne correspond pas à son empreinte)
node scripts/release-sign.mjs sign "$D"
node scripts/release-sign.mjs verify "$D"

# 3. Envoyer la signature
gh release upload "$TAG" "$D/SHA256SUMS.txt.sig" --repo Heiphaistos/ForgeChat

# 4. Tester depuis la release (toujours pré-version), puis publier
gh release edit "$TAG" --repo Heiphaistos/ForgeChat --draft=false
#    ... tests ...
gh release edit "$TAG" --repo Heiphaistos/ForgeChat --prerelease=false
```

Sous PowerShell, remplacer `D="$HOME/..."` par `$D = "$env:USERPROFILE\forgechat-sign\$TAG"`.

Le VPS publie au passage suivant (≤ 5 min). Vérification :

```bash
ssh <vps> 'journalctl -u forgechat-releases-sync -n 20 --no-pager'
curl -fsS https://forgechat.heiphaistos.org/api/desktop/latest | jq '.version, .sums, .sums_sig'
curl -fsS https://forgechat.heiphaistos.org/desktop/mobile.json | jq '.version, .sums, .sums_sig'
```

Si la CI est relancée sur un tag déjà signé, elle remplace les fichiers : la signature ne
correspond plus, le VPS refuse la release (« signature INVALIDE »). Recommencer la procédure.

## Transition

- Les versions déjà installées (bureau ≤ 3.54.0, mobile ≤ 1.27.0) ne vérifient aucune signature :
  la chaîne n'est protégée qu'à partir de la première version qui contient ce code, une fois que
  les utilisateurs l'ont installée.
- Les releases publiées avant ce changement n'ont pas de `.sig`. Le VPS les laisse telles quelles
  (« en attente de signature », sans échec du service) : les manifestes actuels restent servis.
- Recommandé : **signer rétroactivement** les dernières releases publiées (desktop-v3.54.0,
  mobile-v1.27.0) avec la même procédure (étapes 1 à 3). Le VPS republie alors les manifestes avec
  `sums` / `sums_sig`, ce qui permet de vérifier la chaîne de bout en bout avant la prochaine version.
  Les nouvelles applications ne proposent de mise à jour que vers une version plus récente qu'elles :
  une release non signée n'est donc jamais proposée à un client qui vérifie.

## Perte ou fuite de la clé

- **Perte** : impossible de publier une mise à jour acceptée par les applications vérifiantes.
  Générer une nouvelle paire (`node scripts/release-sign.mjs keygen` après avoir déplacé l'ancienne),
  remplacer la clé publique aux quatre endroits listés plus haut, et diffuser une version que les
  utilisateurs devront installer **à la main**. D'où : sauvegarder `private.pem` hors ligne (clé USB
  chiffrée).
- **Fuite** : même procédure, en urgence, et le signaler aux utilisateurs.
