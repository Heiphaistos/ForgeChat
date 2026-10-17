#!/usr/bin/env bash
# Publie une release brouillon créée par la CI (docs/PUBLICATION-SIGNEE.md), en une commande, sur ce PC :
#   scripts/publier-release.sh desktop-vX.Y.Z | mobile-vX.Y.Z
# Bureau : exe Windows signés Authenticode (certificat Heiphaistos), SHA256SUMS.txt recalculé.
# Puis signature hors ligne de SHA256SUMS.txt, envoi, publication, et contrôle du manifeste servi par le VPS.
set -euo pipefail
TAG=${1:-}
case "$TAG" in desktop-v*|mobile-v*) ;; *) echo "usage : $0 desktop-vX.Y.Z|mobile-vX.Y.Z" >&2; exit 2 ;; esac
R=Heiphaistos/ForgeChat
D="${FORGECHAT_SIGN_DIR:-$HOME/forgechat-sign}/$TAG"
cd "$(dirname "$0")/.."

rm -rf "$D" && mkdir -p "$D"
gh release download "$TAG" -R "$R" -D "$D"
rm -f "$D/SHA256SUMS.txt.sig"
(cd "$D" && sha256sum -c --quiet SHA256SUMS.txt)
FILES=$(awk '{print $2}' "$D/SHA256SUMS.txt" | tr -d '*')

if [[ $TAG == desktop-v* ]]; then
  before=$(cd "$D" && sha256sum *.exe)
  powershell -NoProfile -ExecutionPolicy Bypass -File D:/Projet/outils/signer/signer.ps1 $(cd "$D" && for f in *.exe; do cygpath -w "$PWD/$f"; done)
  # shellcheck disable=SC2086
  (cd "$D" && sha256sum $FILES > SHA256SUMS.txt)
  for f in $(cd "$D" && ls *.exe); do
    grep -qF "$(cd "$D" && sha256sum "$f")" <<<"$before" || gh release upload "$TAG" -R "$R" "$D/$f" --clobber
  done
  gh release upload "$TAG" -R "$R" "$D/SHA256SUMS.txt" --clobber
fi

node scripts/release-sign.mjs sign "$D"
node scripts/release-sign.mjs verify "$D"
gh release upload "$TAG" -R "$R" "$D/SHA256SUMS.txt.sig" --clobber
gh release edit "$TAG" -R "$R" --draft=false --prerelease=false >/dev/null

# Le VPS republie au plus 5 min après (il refuse toute release sans signature valide).
V=${TAG#*-v}
URL=https://forgechat.heiphaistos.org/$([[ $TAG == desktop-v* ]] && echo api/desktop/latest || echo desktop/mobile.json)
for _ in $(seq 1 40); do
  if curl -fsS "$URL" | grep -q "\"version\": *\"$V\""; then echo "Publié et servi : $TAG"; exit 0; fi
  sleep 15
done
echo "Release publiée, mais le VPS ne sert pas encore $V : journalctl -u forgechat-releases-sync" >&2
exit 1
