#!/usr/bin/env bash
# Bêta en une commande : build de test lancé sur émulateur → build signé → vérification → release
# GitHub en BROUILLON (jamais publiée).
#
#   scripts/release-beta.sh --server https://ton.domaine --repo propriétaire/dépôt [--livekit wss://…]
#
# --repo : dépôt GitHub PUBLIC des releases. Il sert aussi aux mises à jour proposées par l'app.
# APK et SHA256SUMS.txt rangés dans ~/forgechat-releases/<version>/ (hors dépôt).
# La version vient de app.config.ts (const VERSION) : l'augmenter avant chaque nouvelle bêta.
set -euo pipefail

usage() { echo "usage : release-beta.sh --server https://… --repo propriétaire/dépôt [--livekit wss://…]" >&2; exit 1; }
SERVER="" REPO="" LIVEKIT=()
while [ $# -gt 0 ]; do
  case "$1" in
    --server) SERVER=${2:-}; shift 2 ;;
    --repo) REPO=${2:-}; shift 2 ;;
    --livekit) LIVEKIT=(--livekit "${2:-}"); shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$SERVER" ] && [ -n "$REPO" ] || usage
cd "$(dirname "$0")/.."

VERSION=$(sed -n "s/^const VERSION = '\([0-9.]*\)'.*/\1/p" app.config.ts)
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "ERREUR : VERSION introuvable dans app.config.ts" >&2; exit 1; }
OUT=$HOME/forgechat-releases/$VERSION
APK=$OUT/ForgeChat-$VERSION-beta.apk
# Arrêt AVANT le build si ce brouillon ou cette release existe déjà.
gh auth status >/dev/null 2>&1 || { echo "ERREUR : gh n'est pas connecté (gh auth login)" >&2; exit 1; }
if gh release view "v$VERSION" --repo "$REPO" >/dev/null 2>&1; then
  echo "ERREUR : la release v$VERSION existe déjà sur $REPO : augmente VERSION dans app.config.ts (et package.json)" >&2
  exit 1
fi

mkdir -p "$OUT"

# Même configuration, ABI de l'émulateur : le code Java/JS et les règles R8 sont identiques à l'APK
# distribué ; seul le code natif diffère. Un plantage au démarrage arrête tout avant la release.
echo "== 1/4 Build de test (émulateur x86_64) et démarrage réel"
FORGECHAT_ABIS=x86_64 scripts/build-apk-local.sh production --server "$SERVER" "${LIVEKIT[@]}" --updates-repo "$REPO"
SMOKE=$(mktemp -d)/ForgeChat-$VERSION-beta-x86_64.apk
cp android/app/build/outputs/apk/release/app-release.apk "$SMOKE"
scripts/smoke-test-apk.sh "$SMOKE"
rm -rf "$(dirname "$SMOKE")"

echo "== 2/4 Build de la bêta $VERSION (téléphones)"
scripts/build-apk-local.sh production --server "$SERVER" "${LIVEKIT[@]}" --updates-repo "$REPO"
cp android/app/build/outputs/apk/release/app-release.apk "$APK"

echo "== 3/4 Vérification"
scripts/release-apk.sh "$APK" 5E:A3:DB:62:2C:07:AA:69:54:D8:D9:2F:80:32:6E:24:60:A9:80:9C:94:80:5D:77:06:C0:0D:EC:E3:69:3C:BD

echo "== 4/4 Brouillon de release"
scripts/github-release-draft.sh "$REPO" "$APK"
