#!/usr/bin/env bash
# Construit le paquet pacman a partir du .deb.
# Usage : paquet.sh <ForgeChat-vX.Y.Z-amd64.deb> <sortie.pkg.tar.zst>
# makepkg refuse de tourner en root : en CI, lancer sous un compte ordinaire.
set -euo pipefail

DEB="$(realpath "$1")"
SORTIE="$(realpath -m "$2")"
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

VERSION="$(basename "$DEB" | sed -nE 's/^ForgeChat-v([0-9]+\.[0-9]+\.[0-9]+)-amd64\.deb$/\1/p')"
[ -n "$VERSION" ] || { echo "[ERREUR] nom de .deb inattendu : $DEB"; exit 1; }

TRAVAIL="$(mktemp -d)"
trap 'rm -rf "$TRAVAIL"' EXIT
cp "$ICI/PKGBUILD" "$TRAVAIL/"
cp "$DEB" "$TRAVAIL/forgechat.deb"

# --nodeps : les dependances d'execution n'ont pas a etre installees sur la
# machine de build, pacman les installera chez l'utilisateur.
(cd "$TRAVAIL" && FORGECHAT_VERSION="$VERSION" PKGEXT=.pkg.tar.zst makepkg -f --nodeps --noconfirm >/dev/null)

mv "$TRAVAIL"/forgechat-desktop-"$VERSION"-1-x86_64.pkg.tar.zst "$SORTIE"
