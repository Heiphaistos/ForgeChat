#!/bin/bash
# Vérifier soi-même un téléchargement ForgeChat (audit 2026-10-12, amélioration n° 24).
#
#   ./verifier-telechargement.sh ForgeChat-v3.40.0-windows.msi desktop-v3.40.0.SHA256SUMS.txt
#
# 1. la liste d'empreintes est signée par la clé de publication ForgeChat (Ed25519, signature
#    faite hors ligne, jamais sur GitHub ni sur le serveur) : fichier .sig à côté ;
# 2. le fichier téléchargé a exactement l'empreinte SHA-256 annoncée dans cette liste.
# Prérequis : openssl 3 (Linux, macOS via Homebrew, Windows via Git Bash).
set -euo pipefail
FILE=${1:?usage : verifier-telechargement.sh <fichier> <SHA256SUMS.txt> [clé-publique.pem]}
SUMS=${2:?usage : verifier-telechargement.sh <fichier> <SHA256SUMS.txt> [clé-publique.pem]}
HERE=$(cd "$(dirname "$0")" && pwd)
PUB=${3:-$HERE/../deploy/release-signing-public.pem}
SIG="$SUMS.sig"
[ -f "$SIG" ] || { echo "ÉCHEC : $SIG absent (liste non signée : ne pas installer)." >&2; exit 1; }
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
base64 -d < "$SIG" > "$tmp/sig" 2>/dev/null || { echo "ÉCHEC : signature illisible." >&2; exit 1; }
[ "$(wc -c < "$tmp/sig")" -eq 64 ] || { echo "ÉCHEC : signature de taille inattendue." >&2; exit 1; }
if ! openssl pkeyutl -verify -pubin -inkey "$PUB" -rawin -in "$SUMS" -sigfile "$tmp/sig" >/dev/null 2>&1; then
  echo "ÉCHEC : la liste d'empreintes n'est PAS signée par ForgeChat. Ne pas installer." >&2
  exit 1
fi
name=$(basename "$FILE")
want=$(awk -v n="$name" '{ f=$2; sub(/^\*/, "", f); if (f == n) print $1 }' "$SUMS")
[ -n "$want" ] || { echo "ÉCHEC : $name n'est pas dans la liste signée." >&2; exit 1; }
got=$( (sha256sum "$FILE" 2>/dev/null || shasum -a 256 "$FILE") | cut -d' ' -f1)
if [ "$got" != "$want" ]; then
  echo "ÉCHEC : empreinte différente. Fichier modifié ou corrompu : ne pas installer." >&2
  exit 1
fi
echo "OK : $name est authentique (liste signée par ForgeChat, empreinte $got)."
