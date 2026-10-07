#!/usr/bin/env bash
# Dépose les modèles de l'IA sur l'appareil dans le dossier statique servi en /ai-models/
# (docs/IA-SUR-APPAREIL.md). Liste, tailles et empreintes : client/src/ai/models.json.
# Idempotent : un fichier déjà présent et intact n'est pas retéléchargé ; un fichier dont
# l'empreinte SHA-256 diffère n'est JAMAIS mis en place.
#   Usage : deploy/ai-models-fetch.sh [dossier]   (défaut /srv/forgechat-ai-models)
set -euo pipefail

DEST="${1:-/srv/forgechat-ai-models}"
MANIFEST="$(cd "$(dirname "$0")/.." && pwd)/client/src/ai/models.json"
[[ -f "$MANIFEST" ]] || { echo "Manifeste introuvable : $MANIFEST" >&2; exit 1; }
command -v python3 >/dev/null && command -v curl >/dev/null && command -v sha256sum >/dev/null \
  || { echo "python3, curl et sha256sum sont requis" >&2; exit 1; }

mkdir -p "$DEST"
python3 - "$MANIFEST" <<'EOF' | while IFS=$'\t' read -r path size sha src; do
import json, sys
for p in json.load(open(sys.argv[1]))["packs"].values():
    for f in p["files"]:
        assert ".." not in f["path"] and not f["path"].startswith("/"), f["path"]
        print(f["path"], f["size"], f["sha256"], f["src"], sep="\t")
EOF
  src="${src%$'\r'}"
  out="$DEST/$path"
  if [[ -f "$out" ]] && echo "$sha  $out" | sha256sum -c --status; then
    echo "ok      $path"
    continue
  fi
  mkdir -p "$(dirname "$out")"
  tmp="$out.part"
  curl -fsSL --retry 3 -o "$tmp" "$src"
  if echo "$sha  $tmp" | sha256sum -c --status && [[ "$(stat -c %s "$tmp")" == "$size" ]]; then
    mv -f "$tmp" "$out"
    echo "déposé  $path"
  else
    rm -f "$tmp"
    echo "REFUSÉ  $path : empreinte ou taille incorrecte" >&2
    exit 1
  fi
done
chmod -R a+rX "$DEST"
echo "Modèles prêts dans $DEST ($(du -sh "$DEST" | cut -f1))"
