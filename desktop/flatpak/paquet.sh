#!/usr/bin/env bash
# Construit le paquet Flatpak a partir du .deb.
# Usage : paquet.sh <ForgeChat-vX.Y.Z-amd64.deb> <sortie.flatpak>
# Besoin : flatpak, et flatpak-builder (commande, ou `flatpak install flathub org.flatpak.Builder`).
set -euo pipefail

DEB="$(realpath "$1")"
SORTIE="$(realpath -m "$2")"
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ID=org.heiphaistos.forgechat

VERSION="$(basename "$DEB" | sed -nE 's/^ForgeChat-v([0-9]+\.[0-9]+\.[0-9]+)-amd64\.deb$/\1/p')"
[ -n "$VERSION" ] || { echo "[ERREUR] nom de .deb inattendu : $DEB"; exit 1; }

if command -v flatpak-builder >/dev/null; then
    BUILDER=(flatpak-builder)
else
    BUILDER=(flatpak run --filesystem=host org.flatpak.Builder)
fi

# Dans le dossier du depot (et non /tmp) : org.flatpak.Builder ne voit que l'hote monte.
TRAVAIL="$(mktemp -d "$ICI/.build-XXXXXX")"
trap 'rm -rf "$TRAVAIL"' EXIT
cp -r "$ICI/$ID.yml" "$ICI/$ID.metainfo.xml" "$ICI/shared-modules" "$TRAVAIL/"
cp "$DEB" "$TRAVAIL/forgechat.deb"
# Version et date de la release dans les metadonnees AppStream.
sed -i "s|<content_rating type=\"oars-1.1\"/>|&\n  <releases><release version=\"$VERSION\" date=\"$(date -u +%F)\"/></releases>|" "$TRAVAIL/$ID.metainfo.xml"

"${BUILDER[@]}" --user --install-deps-from=flathub --disable-rofiles-fuse --force-clean \
    --state-dir="$TRAVAIL/.state" --repo="$TRAVAIL/repo" "$TRAVAIL/build" "$TRAVAIL/$ID.yml"
# --runtime-repo : a l'installation, flatpak va chercher le runtime GNOME sur Flathub tout seul.
flatpak build-bundle --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo \
    "$TRAVAIL/repo" "$SORTIE" "$ID"
