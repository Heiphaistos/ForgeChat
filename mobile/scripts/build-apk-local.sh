#!/usr/bin/env bash
# Build local d'un APK signé (sans EAS) : APK DEV (preview) ou bêta (production).
#
#   scripts/build-apk-local.sh production --server https://ton.domaine [--livekit wss://media.domaine]
#   scripts/build-apk-local.sh preview   [--server https://preprod.domaine]
#
# --server  : adresse du serveur ForgeChat. OBLIGATOIRE pour la bêta (aucune adresse par défaut),
#             https:// vers un vrai nom de domaine (ni IP locale, ni localhost, ni domaine réservé).
#             Facultative pour l'APK DEV : préréglage « Pré-prod » (le serveur se choisit dans l'app).
# --livekit : serveur LiveKit, seulement s'il n'est PAS sur le même hôte que --server (wss://).
#
# Clé de release HORS dépôt (voir docs/MAINTAINER.md, « Clé de release ») :
#   FORGECHAT_KEYSTORE                (défaut : ~/.config/forgechat-dev/release/forgechat-release.keystore)
#   FORGECHAT_KEYSTORE_PASSWORD_FILE  (défaut : ~/.config/forgechat-dev/release/keystore.password)
# Push Android (facultatif) : GOOGLE_SERVICES_JSON=/chemin/google-services.json, EAS_PROJECT_ID=…
# ABI : arm64-v8a + armeabi-v7a (téléphones) ; FORGECHAT_ABIS=x86_64 pour tester sur l'émulateur.
# Garde-fous machine : 2 workers gradle, arrêt si le swap dépasse 80 %. APK produit :
#   android/app/build/outputs/apk/release/app-release.apk
# Le .env.local n'est PAS lu (EXPO_NO_DOTENV) : le serveur vient uniquement de --server.
set -euo pipefail

usage() { echo "usage : build-apk-local.sh preview|production [--server https://…] [--livekit wss://…]" >&2; exit 1; }
PROFILE=${1:-}
case "$PROFILE" in preview | production) shift ;; *) usage ;; esac
SERVER=""
LIVEKIT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --server) SERVER=${2:-}; shift 2 ;;
    --livekit) LIVEKIT=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done
cd "$(dirname "$0")/.."
ROOT=$(pwd)

# Vérification des adresses AVANT toute compilation (mêmes règles que app.config.ts).
node -e '
const { distributedServerConfig } = require("./plugins/serverConfig.js")
try { const c = distributedServerConfig(process.argv[1], process.argv[2], process.argv[3]); console.log("Serveur : " + (c.apiUrl || "(aucun : choisi dans l’app)") + (c.livekitHost ? " ; LiveKit : " + c.livekitHost : "")) }
catch (e) { console.error("ERREUR : " + e.message); process.exit(1) }
' "$PROFILE" "$SERVER" "$LIVEKIT"

export EXPO_NO_DOTENV=1 NODE_ENV=production APP_ENV=$PROFILE EXPO_PUBLIC_APP_ENV=$PROFILE
export FORGECHAT_API_URL=$SERVER FORGECHAT_LIVEKIT_URL=$LIVEKIT
export FORGECHAT_KEYSTORE=${FORGECHAT_KEYSTORE:-$HOME/.config/forgechat-dev/release/forgechat-release.keystore}
export FORGECHAT_KEYSTORE_PASSWORD_FILE=${FORGECHAT_KEYSTORE_PASSWORD_FILE:-$HOME/.config/forgechat-dev/release/keystore.password}
[ -f "$FORGECHAT_KEYSTORE" ] && [ -f "$FORGECHAT_KEYSTORE_PASSWORD_FILE" ] || {
  echo "Clé de release introuvable : voir docs/MAINTAINER.md" >&2
  exit 1
}
# Retire le chemin du dossier personnel des bibliothèques natives compilées localement.
export CFLAGS="-ffile-prefix-map=$HOME=/build" CXXFLAGS="-ffile-prefix-map=$HOME=/build"

# Bêta : client de développement exclu de l'autolinking (comme le crochet EAS), package.json restauré ensuite.
BACKUP=$(mktemp)
cp package.json "$BACKUP"
trap 'cp "$BACKUP" "$ROOT/package.json"; rm -f "$BACKUP"' EXIT
[ "$PROFILE" = production ] && node scripts/eas-build-pre-install.js

npx expo prebuild --platform android --clean --no-install

cd android
./gradlew assembleRelease --no-daemon --max-workers=2 -PreactNativeArchitectures="${FORGECHAT_ABIS:-arm64-v8a,armeabi-v7a}" --console=plain &
G=$!
while kill -0 $G 2>/dev/null; do
  read -r total used <<<"$(free -m | awk '/^(Swap|Échange)/{print $2, $3}')"
  if [ "${total:-0}" -gt 0 ] && [ $((used * 100 / total)) -gt 80 ]; then
    echo "Swap > 80 % : arrêt du build" >&2
    pkill -TERM -P $G || true
    kill -TERM $G || true
    exit 2
  fi
  sleep 5
done
wait $G
echo "APK : $(pwd)/app/build/outputs/apk/release/app-release.apk"
echo "Vérifier puis empreintes : scripts/release-apk.sh <copie renommée de l'APK>"
