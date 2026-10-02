#!/usr/bin/env bash
# Build local d'un APK signé (sans EAS) : APK DEV (preview) ou bêta (production).
#
#   scripts/build-apk-local.sh preview|production [URL-pré-prod-https pour preview]
#
# Clé de release HORS dépôt (voir docs/MAINTAINER.md, « Clé de release ») :
#   FORGECHAT_KEYSTORE                (défaut : ~/.config/forgechat-dev/release/forgechat-release.keystore)
#   FORGECHAT_KEYSTORE_PASSWORD_FILE  (défaut : ~/.config/forgechat-dev/release/keystore.password)
# ABI : arm64-v8a + armeabi-v7a (téléphones) ; FORGECHAT_ABIS=x86_64 pour tester sur l'émulateur.
# Garde-fous machine : 2 workers gradle, arrêt si le swap dépasse 80 %. APK produit :
#   android/app/build/outputs/apk/release/app-release.apk
# Le .env.local n'est PAS lu (EXPO_NO_DOTENV) : le serveur vient uniquement du profil.
set -euo pipefail

PROFILE=${1:?usage: build-apk-local.sh preview|production [url-pré-prod]}
case "$PROFILE" in preview | production) ;; *) echo "profil inconnu : $PROFILE" >&2; exit 1 ;; esac
cd "$(dirname "$0")/.."
ROOT=$(pwd)

export EXPO_NO_DOTENV=1 NODE_ENV=production APP_ENV=$PROFILE EXPO_PUBLIC_APP_ENV=$PROFILE
if [ "$PROFILE" = production ]; then
  # Serveur de la bêta : celui du profil EAS production (eas.json), même valeur qu'un build EAS.
  FORGECHAT_API_URL=$(node -p "require('./eas.json').build.production.env.FORGECHAT_API_URL")
  export FORGECHAT_API_URL
else
  export FORGECHAT_API_URL=${2:-}
fi
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
