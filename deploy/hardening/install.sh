#!/bin/bash
# Durcissement du VPS (amélioration n° 17) : SSH par clé seulement et sans root, fail2ban,
# mises à jour de sécurité automatiques. À lancer en root, une fois :
#   sudo bash /opt/forgechat/deploy/hardening/install.sh <utilisateur-admin>
# Garde-fous : refuse de couper l'accès root si <utilisateur-admin> n'a ni clé SSH ni sudo, et
# valide la config (`sshd -t`) avant de recharger. Gardez votre session SSH ouverte et testez
# une NOUVELLE connexion avant de la fermer.
set -euo pipefail
ADMIN=${1:?usage : install.sh <utilisateur-admin non-root>}
HERE=$(cd "$(dirname "$0")" && pwd)
[ "$(id -u)" = 0 ] || { echo "À lancer en root (sudo)." >&2; exit 1; }
[ "$ADMIN" != root ] || { echo "Il faut un compte admin non-root." >&2; exit 1; }
id "$ADMIN" >/dev/null 2>&1 || { echo "Compte $ADMIN introuvable." >&2; exit 1; }
home=$(getent passwd "$ADMIN" | cut -d: -f6)
grep -qE '^(ssh-|ecdsa-|sk-)' "$home/.ssh/authorized_keys" 2>/dev/null \
  || { echo "$ADMIN n'a pas de clé SSH dans $home/.ssh/authorized_keys : arrêt (vous seriez enfermé dehors)." >&2; exit 1; }
id -nG "$ADMIN" | grep -qwE 'sudo|wheel' \
  || { echo "$ADMIN n'est pas dans le groupe sudo : arrêt." >&2; exit 1; }

apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq fail2ban unattended-upgrades >/dev/null

install -m 0644 "$HERE/sshd-forgechat.conf" /etc/ssh/sshd_config.d/10-forgechat.conf
if ! sshd -t; then
  rm -f /etc/ssh/sshd_config.d/10-forgechat.conf
  echo "Configuration SSH invalide : rien n'est changé." >&2
  exit 1
fi
systemctl reload ssh 2>/dev/null || systemctl reload sshd

install -m 0644 "$HERE/fail2ban-forgechat.local" /etc/fail2ban/jail.d/forgechat.local
command -v ufw >/dev/null || sed -i 's/^banaction = ufw/banaction = iptables-multiport/' /etc/fail2ban/jail.d/forgechat.local
fail2ban-client -t >/dev/null
systemctl enable --now fail2ban >/dev/null
systemctl restart fail2ban

# Correctifs de sécurité Debian/Ubuntu appliqués chaque jour.
printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > /etc/apt/apt.conf.d/20auto-upgrades

echo "OK. Testez MAINTENANT une nouvelle connexion : ssh $ADMIN@<vps> (sans fermer celle-ci)."
fail2ban-client status
