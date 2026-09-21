#!/usr/bin/env bash
# Genere le manifeste de mise a jour a partir des artefacts de dist-desktop/.
#
# Calcule l'empreinte SHA-256 de chaque artefact present et ecrit
# dist-desktop/latest.json. Ce fichier est ensuite depose sur le VPS a
# l'emplacement pointe par FORGECHAT_DESKTOP_MANIFEST cote serveur, et les
# artefacts dans le dossier statique pointe par FORGECHAT_DESKTOP_BASE_URL.
#
# L'empreinte est LA garde : l'application refuse d'installer un fichier dont
# le SHA-256 ne correspond pas. La calculer a la main quatre fois par release
# est exactement le genre d'erreur qui se paye en mise a jour impossible.
#
# Usage :
#   ./publier-manifeste.sh                      # notes vides
#   ./publier-manifeste.sh notes-de-version.md  # notes lues dans un fichier
#
# La version n'est PAS un argument : elle est lue dans tauri.conf.json, seule
# source de verite (meme regle que build.bat / build.sh).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$(cd "$SCRIPT_DIR/.." && pwd)/dist-desktop"

command -v node >/dev/null || { echo "[ERREUR] Node.js non trouve."; exit 1; }

# Sous Git Bash, bash manipule des chemins POSIX (/c/Users/...) que le node de
# Windows ne sait pas ouvrir. Ne convertir qu'au moment de passer un chemin a
# node ; le reste du script reste en chemins POSIX.
chemin_natif() {
    if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi
}

VERSION="$(node -p "require(process.argv[1]).version" "$(chemin_natif "$SCRIPT_DIR/src-tauri/tauri.conf.json")")"
[ -n "$VERSION" ] || { echo "[ERREUR] Version illisible dans src-tauri/tauri.conf.json"; exit 1; }

NOTES=""
if [ $# -ge 1 ]; then
    [ -f "$1" ] || { echo "[ERREUR] Fichier de notes introuvable : $1"; exit 1; }
    NOTES="$(cat "$1")"
fi

# cible du manifeste -> nom de l'artefact produit par build.bat / build.sh
declare -A ARTEFACTS=(
    [windows-x86_64]="ForgeChat-Setup-v$VERSION.exe"
    [windows-portable]="ForgeChat-Portable-v$VERSION.exe"
    [linux-x86_64]="ForgeChat-v$VERSION-amd64.deb"
    [linux-portable]="ForgeChat-v$VERSION-amd64.AppImage"
)

empreinte() {
    if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1
    else shasum -a 256 "$1" | cut -d' ' -f1
    fi
}

PLATFORMS="{}"
MANQUANTS=0
for cible in "${!ARTEFACTS[@]}"; do
    fichier="$OUT/${ARTEFACTS[$cible]}"
    if [ ! -f "$fichier" ]; then
        echo "[WARN] Absent, cible ignoree : ${ARTEFACTS[$cible]}"
        MANQUANTS=$((MANQUANTS + 1))
        continue
    fi
    sha="$(empreinte "$fichier")"
    taille="$(wc -c < "$fichier" | tr -d ' ')"
    echo "[OK] $cible  $sha  ${ARTEFACTS[$cible]}"
    # L'url reste RELATIVE : le serveur la prefixe avec FORGECHAT_DESKTOP_BASE_URL.
    PLATFORMS="$(node -e '
        const [base, cible, url, sha256, size] = process.argv.slice(1);
        const p = JSON.parse(base);
        p[cible] = { url, sha256, size: Number(size) };
        process.stdout.write(JSON.stringify(p));
    ' "$PLATFORMS" "$cible" "${ARTEFACTS[$cible]}" "$sha" "$taille")"
done

if [ "$MANQUANTS" -eq 4 ]; then
    echo "[ERREUR] Aucun artefact trouve dans $OUT pour la version $VERSION."
    exit 1
fi

node -e '
    const [version, notes, pub_date, platforms, out] = process.argv.slice(1);
    require("fs").writeFileSync(out, JSON.stringify(
        { version, notes, pub_date, platforms: JSON.parse(platforms) }, null, 2) + "\n");
' "$VERSION" "$NOTES" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PLATFORMS" "$(chemin_natif "$OUT/latest.json")"

echo
echo "[OK] Manifeste : dist-desktop/latest.json (version $VERSION)"
echo "     Deposer latest.json a l'emplacement FORGECHAT_DESKTOP_MANIFEST du serveur,"
echo "     et les artefacts dans le dossier servi par FORGECHAT_DESKTOP_BASE_URL."
