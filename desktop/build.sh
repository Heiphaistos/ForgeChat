#!/usr/bin/env bash
# ForgeChat Desktop Builder — Linux (.deb + AppImage)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT="$ROOT_DIR/dist-desktop"

command -v rustc >/dev/null || { echo "[ERREUR] Rust non trouve. Installe depuis https://rustup.rs"; exit 1; }
command -v node  >/dev/null || { echo "[ERREUR] Node.js non trouve."; exit 1; }
command -v cargo >/dev/null || { echo "[ERREUR] Cargo non trouve."; exit 1; }
pkg-config --exists webkit2gtk-4.1 || { echo "[ERREUR] libwebkit2gtk-4.1-dev manquant (apt install libwebkit2gtk-4.1-dev)."; exit 1; }

# Version lue depuis tauri.conf.json (source de verite utilisee par Tauri pour
# nommer les artefacts de build) plutot que codee en dur -- un litteral fige
# ici se perime a chaque bump de version (meme bug que build.bat, cf. sa doc :
# trouve le 2026-08-03, recree entre-temps par un bump normal de version
# pendant cette session, le script visait encore "3.19.0" en etant a 3.20.0).
VERSION="$(node -p "require('$SCRIPT_DIR/src-tauri/tauri.conf.json').version")"
if [ -z "$VERSION" ]; then
    echo "[ERREUR] Impossible de lire la version depuis src-tauri/tauri.conf.json"
    exit 1
fi

echo "============================================"
echo "  ForgeChat Desktop Builder v$VERSION (Linux)"
echo "============================================"

echo "[1/4] Build du client React..."
cd "$ROOT_DIR/client"
npm ci --prefer-offline || npm install
npm run build

echo "[2/4] Installation deps desktop..."
cd "$SCRIPT_DIR"
npm install --silent

echo "[3/4] Compilation Tauri (deb + appimage)..."
npx tauri build --bundles deb,appimage

echo "[4/4] Copie des artefacts dans dist-desktop/..."
mkdir -p "$OUT"
BUNDLE="$SCRIPT_DIR/src-tauri/target/release/bundle"

# Matcher explicitement sur $VERSION -- bundle/{deb,appimage}/ accumule les
# artefacts des builds precedents (Tauri ne nettoie pas), donc un simple
# "*.deb -print -quit" peut renvoyer un ancien fichier au hasard de l'ordre
# d'enumeration disque (bug reel trouve le 2026-08-03 sur l'equivalent
# Windows build.bat : v3.17.0 copiee sous le nom v3.18.0).
DEB_SRC=$(find "$BUNDLE/deb" -name "*${VERSION}*.deb" -print -quit 2>/dev/null || true)
if [ -n "$DEB_SRC" ]; then
    cp "$DEB_SRC" "$OUT/ForgeChat-v$VERSION-amd64.deb"
    echo "[OK] .deb       : dist-desktop/ForgeChat-v$VERSION-amd64.deb"
else
    echo "[WARN] .deb non trouve dans $BUNDLE/deb/"
fi

APPIMAGE_SRC=$(find "$BUNDLE/appimage" -name "*${VERSION}*.AppImage" -print -quit 2>/dev/null || true)
if [ -n "$APPIMAGE_SRC" ]; then
    cp "$APPIMAGE_SRC" "$OUT/ForgeChat-v$VERSION-amd64.AppImage"
    chmod +x "$OUT/ForgeChat-v$VERSION-amd64.AppImage"
    echo "[OK] AppImage   : dist-desktop/ForgeChat-v$VERSION-amd64.AppImage"
else
    echo "[WARN] AppImage non trouve dans $BUNDLE/appimage/"
fi

echo
echo "============================================"
echo "  Build termine ! Dossier : dist-desktop/"
echo "============================================"
