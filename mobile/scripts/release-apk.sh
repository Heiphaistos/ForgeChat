#!/usr/bin/env bash
# Vérifie un APK ForgeChat avant distribution et ajoute ses empreintes à SHA256SUMS.txt (même dossier).
#
#   scripts/release-apk.sh <fichier.apk> [empreinte-SHA-256-attendue-du-certificat]
#
# Échoue (code ≠ 0) si : signature invalide, certificat différent de celui attendu, APK débogable,
# ou — pour la bêta (package org.heiphaistos.forgechat) — trafic en clair autorisé, outils de dev
# présents dans le bundle, URL http:// ou adresse locale dans le bundle.
# Prérequis : Android SDK (build-tools : apksigner, aapt2), unzip, sha256sum. Voir docs/MAINTAINER.md.
set -euo pipefail

APK=${1:?usage: release-apk.sh <fichier.apk> [empreinte SHA-256 attendue]}
EXPECTED=${2:-}
SDK=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}
BT=$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)
APKSIGNER=$BT/apksigner
AAPT2=$BT/aapt2
BETA_PACKAGE=org.heiphaistos.forgechat
fail() { echo "ÉCHEC : $*" >&2; exit 1; }

[ -f "$APK" ] || fail "fichier introuvable : $APK"

# 1. Signature et certificat
CERTS=$("$APKSIGNER" verify --print-certs "$APK") || fail "signature invalide"
CERT_SHA256=$(echo "$CERTS" | awk -F': ' '/certificate SHA-256 digest/{print $2; exit}')
CERT_SHA1=$(echo "$CERTS" | awk -F': ' '/certificate SHA-1 digest/{print $2; exit}')
[ "$(echo "$CERTS" | grep -c 'certificate SHA-256 digest')" = 1 ] || fail "un seul certificat de signature attendu"
if [ -n "$EXPECTED" ]; then
  norm() { echo "$1" | tr -d ': ' | tr '[:upper:]' '[:lower:]'; }
  [ "$(norm "$CERT_SHA256")" = "$(norm "$EXPECTED")" ] || fail "certificat inattendu ($CERT_SHA256)"
fi
echo "$CERTS" | grep -qi 'Android Debug' && fail "signé avec une clé debug"

# 2. Identité et manifeste
BADGING=$("$AAPT2" dump badging "$APK")
PACKAGE=$(echo "$BADGING" | sed -n "s/^package: name='\([^']*\)'.*/\1/p")
VERSION=$(echo "$BADGING" | sed -n "s/.*versionName='\([^']*\)'.*/\1/p")
CODE=$(echo "$BADGING" | sed -n "s/.*versionCode='\([^']*\)'.*/\1/p")
MANIFEST=$("$AAPT2" dump xmltree --file AndroidManifest.xml "$APK")
echo "$MANIFEST" | grep -q 'debuggable.*=true' && fail "APK débogable"
CLEARTEXT=$(echo "$MANIFEST" | grep -q 'usesCleartextTraffic.*=true' && echo oui || echo non)

# 3. Contrôles propres à la bêta publique
if [ "$PACKAGE" = "$BETA_PACKAGE" ]; then
  [ "$CLEARTEXT" = non ] || fail "bêta : trafic en clair autorisé"
  echo "$MANIFEST" | grep -q networkSecurityConfig && fail "bêta : network_security_config présent"
  echo "$MANIFEST" | grep -q '"exp+' && fail "bêta : schéma exp+ du client de développement présent"
  TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
  unzip -q -o "$APK" 'assets/index.android.bundle' -d "$TMP" || fail "bundle JS introuvable"
  BUNDLE=$TMP/assets/index.android.bundle
  for s in 'Infos dev' 'Changer de serveur' 'Serveur (dev)' 'Exporter les journaux' 'devServerOrigin' 'expo-dev-launcher' 'DevLauncher'; do
    strings "$BUNDLE" | grep -qF "$s" && fail "bêta : élément de dev dans le bundle (« $s »)"
  done
  # Adresses de dev ou de réseau local (les bibliothèques contiennent des http:// inoffensifs :
  # espaces de noms, valeur par défaut interne d'expo-router « localhost:8081 »).
  strings "$BUNDLE" | grep -qE 'https?://(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|127\.0\.0\.1)|10\.0\.2\.2' &&
    fail "bêta : adresse locale ou de dev dans le bundle"
  grep -qF "https://forgechat.heiphaistos.org" <(strings "$BUNDLE") || echo "ATTENTION : URL de prod par défaut absente du bundle (serveur personnalisé ?)"
  unzip -l "$APK" | grep -qE 'devlauncher|devmenu|expo-dev-' && fail "bêta : client de développement présent"
  unzip -l "$APK" | grep -qE '\.map$' && fail "bêta : source map présente"
fi

# 4. Empreintes
SUMS=$(dirname "$APK")/SHA256SUMS.txt
FILE_SHA256=$(sha256sum "$APK" | awk '{print $1}')
NAME=$(basename "$APK")
touch "$SUMS"
grep -v -F "$NAME" "$SUMS" > "$SUMS.tmp" || true
{
  cat "$SUMS.tmp"
  echo "$FILE_SHA256  $NAME"
  echo "# $NAME : $PACKAGE $VERSION (versionCode $CODE), certificat SHA-256 $CERT_SHA256, SHA-1 $CERT_SHA1"
} > "$SUMS"
rm -f "$SUMS.tmp"

echo "OK $NAME"
echo "  package      $PACKAGE $VERSION (versionCode $CODE)"
echo "  clair (OS)   $CLEARTEXT"
echo "  SHA-256      $FILE_SHA256"
echo "  certificat   SHA-256 $CERT_SHA256"
echo "               SHA-1   $CERT_SHA1"
