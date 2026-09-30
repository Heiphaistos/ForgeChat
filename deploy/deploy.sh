#!/bin/bash
# Lance par /usr/local/sbin/deployer sur le VPS (minuteur deployer-auto, toutes les 2 min)
# apres alignement de /opt/forgechat sur la branche par defaut de GitHub.
set -euo pipefail
exec bash ./deploy.sh
