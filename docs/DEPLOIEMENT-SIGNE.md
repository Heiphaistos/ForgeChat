# Déploiement signé (audit 2026-10-12, M8)

> **En place depuis le 2026-10-17** : clé `D:\MDPorgechat-signingorgechat_signing` (copie E:\MDP), signature
> automatique configurée dans le dépôt local (`commit.gpgsign`, `gpg.format ssh`), garde installée sur le VPS et appelée par
> `/usr/local/sbin/deployer` avant tout alignement de `/opt/forgechat`. Une fusion faite sur GitHub (Dependabot) n'est
> déployée qu'une fois recouverte par un commit signé poussé depuis ce PC.

Aujourd'hui `deployer-auto` aligne `/opt/forgechat` sur la branche par défaut de GitHub toutes les
2 minutes. Quiconque peut pousser sur cette branche (compte GitHub volé, jeton fuité, application
tierce) fait donc exécuter son code sur le VPS et servir un client web piégé à tous les
utilisateurs : le chiffrement de bout en bout du web ne tient plus.

La garde `deploy/verify-signed-head.sh` n'accepte qu'un commit **signé par une clé SSH que tu
autorises sur le VPS** et **descendant du dernier commit déployé** (pas de retour arrière vers une
ancienne version vulnérable). Elle doit vivre HORS du dépôt : un `deploy.sh` du dépôt peut être
réécrit par l'attaquant.

## 1. Une clé de signature (sur ton ordinateur)

```sh
ssh-keygen -t ed25519 -C "forgechat-release" -f ~/.ssh/forgechat_signing
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/forgechat_signing.pub
git config --global commit.gpgsign true
```

Garde la clé privée hors du dépôt, idéalement sur une clé matérielle (`-t ed25519-sk`).

## 2. Sur le VPS (root)

```sh
install -d -m 755 /etc/forgechat /var/lib/forgechat
# Une ligne par clé autorisée : « <nom> <contenu de forgechat_signing.pub> »
echo "momo $(cat forgechat_signing.pub)" > /etc/forgechat/allowed_signers
chmod 644 /etc/forgechat/allowed_signers
install -m 755 /opt/forgechat/deploy/verify-signed-head.sh /usr/local/sbin/forgechat-verify-head
```

Puis dans `/usr/local/sbin/deployer`, remplacer l'alignement direct par :

```sh
git -C /opt/forgechat fetch origin main
/usr/local/sbin/forgechat-verify-head /opt/forgechat FETCH_HEAD || exit 1
git -C /opt/forgechat reset --hard FETCH_HEAD
```

Premier lancement : `/var/lib/forgechat/last-deployed` est créé ; ensuite, toute tentative de revenir
à un commit plus ancien est refusée (pour revenir en arrière volontairement, faire un nouveau commit
signé qui annule le changement).

## 3. Points d'attention

- **Tout commit de `main` doit être signé par une clé de la liste.** Une fusion faite dans
  l'interface web de GitHub est signée par la clé GPG de GitHub, pas par la tienne : elle sera
  refusée. Fusionner en local (`git merge --ff-only` ou `git merge -S`), puis pousser.
- Les commits faits par Claude Code dans une session cloud sont signés par la clé de cette
  session : soit tu les ré-signes en fusionnant en local, soit tu ajoutes la clé de la session à
  `allowed_signers` (déconseillé : elle n'est pas sous ton contrôle).
- Côté GitHub : protection de la branche `main` (pas de push forcé, revue obligatoire, commits
  signés exigés) et double authentification par clé matérielle sur le compte.
- La garde vérifie le commit de tête. Pour une confiance maximale, signer aussi chaque commit
  intermédiaire, ou ne déployer que des tags signés (`git verify-tag`).

Tests de la garde (réalisés le 2026-10-12) : commit signé accepté ; non signé, signé par une autre
clé, retour arrière et liste absente refusés ; une configuration git globale piégée
(`gpg.ssh.program`) ne change rien.
