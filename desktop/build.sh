#!/usr/bin/env bash
# ForgeChat Desktop Builder v3.18.0 — Linux (.deb + AppImage)
set -euo pipefail

VERSION="3.18.0"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT="$ROOT_DIR/dist-desktop"

echo "============================================"
echo "  ForgeChat Desktop Builder v$VERSION (Linux)"
echo "============================================"

command -v rustc >/dev/null || { echo "[ERREUR] Rust non trouve. Installe depuis https://rustup.rs"; exit 1; }
command -v node  >/dev/null || { echo "[ERREUR] Node.js non trouve."; exit 1; }
command -v cargo >/dev/null || { echo "[ERREUR] Cargo non trouve."; exit 1; }
pkg-config --exists webkit2gtk-4.1 || { echo "[ERREUR] libwebkit2gtk-4.1-dev manquant (apt install libwebkit2gtk-4.1-dev)."; exit 1; }

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

DEB_SRC=$(find "$BUNDLE/deb" -name '*.deb' -print -quit 2>/dev/null || true)
if [ -n "$DEB_SRC" ]; then
    cp "$DEB_SRC" "$OUT/ForgeChat-v$VERSION-amd64.deb"
    echo "[OK] .deb       : dist-desktop/ForgeChat-v$VERSION-amd64.deb"
else
    echo "[WARN] .deb non trouve dans $BUNDLE/deb/"
fi

APPIMAGE_SRC=$(find "$BUNDLE/appimage" -name '*.AppImage' -print -quit 2>/dev/null || true)
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
