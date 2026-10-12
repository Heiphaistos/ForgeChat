#!/bin/bash
# Garde du déploiement automatique (audit 2026-10-12, M8). À copier HORS du dépôt
# (/usr/local/sbin/forgechat-verify-head, root:root 755) et à appeler par `deployer` APRÈS
# `git fetch` et AVANT d'aligner /opt/forgechat :
#
#   git -C /opt/forgechat fetch origin main
#   /usr/local/sbin/forgechat-verify-head /opt/forgechat FETCH_HEAD || exit 1
#   git -C /opt/forgechat reset --hard FETCH_HEAD
#
# Refuse (code ≠ 0) un commit :
#  - non signé, ou signé par une clé absente de /etc/forgechat/allowed_signers (format
#    `ssh-keygen -Y`, root:root 644) ;
#  - qui n'est pas un descendant du dernier commit déployé (pas de retour arrière vers une
#    ancienne version vulnérable), mémorisé dans /var/lib/forgechat/last-deployed.
# Le script vit hors du dépôt : un compte GitHub compromis ne peut ni le modifier ni le contourner.
set -euo pipefail

REPO="${1:?usage: $0 <dépôt> <commit>}"
REF="${2:?usage: $0 <dépôt> <commit>}"
SIGNERS="${FORGECHAT_ALLOWED_SIGNERS:-/etc/forgechat/allowed_signers}"
STATE="${FORGECHAT_DEPLOY_STATE:-/var/lib/forgechat/last-deployed}"

die() { echo "forgechat-verify-head : $*" >&2; exit 1; }

[[ -s "$SIGNERS" ]] || die "liste des signataires absente ou vide ($SIGNERS) : déploiement refusé"
commit=$(git -C "$REPO" rev-parse --verify "$REF^{commit}") || die "commit introuvable : $REF"

git -C "$REPO" -c gpg.format=ssh -c gpg.ssh.program=ssh-keygen -c gpg.ssh.allowedSignersFile="$SIGNERS" verify-commit "$commit" >/dev/null 2>&1 \
  || die "commit $commit non signé par une clé autorisée : déploiement refusé"

if [[ -s "$STATE" ]]; then
  last=$(tr -d '[:space:]' < "$STATE")
  if [[ "$last" != "$commit" ]] && ! git -C "$REPO" merge-base --is-ancestor "$last" "$commit" 2>/dev/null; then
    die "commit $commit n'est pas un descendant du dernier déployé ($last) : retour arrière refusé"
  fi
fi

mkdir -p "$(dirname "$STATE")"
printf '%s\n' "$commit" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"
echo "forgechat-verify-head : $commit signé et autorisé"
