# Guide du mainteneur — app mobile ForgeChat (Android)

Ce guide décrit, étape par étape, comment déployer le serveur, construire, signer, vérifier et
distribuer l'app mobile. Chaque étape donne la commande exacte et le résultat attendu. Il ne contient
aucun secret : les mots de passe, la clé de signature et les `.env` circulent **à part** (voir §4).

Commandes à lancer depuis la racine du dépôt, sauf mention contraire. `mobile/` = dossier de l'app.

---

## 1. Les quatre variantes

| Variante | Profil | Package | Nom affiché | Serveur | Pour qui |
|---|---|---|---|---|---|
| development | `development` | `org.heiphaistos.forgechat.development` | ForgeChat (development) | local (Metro + émulateur) | développeurs |
| lan | `lan` (build local) | `org.heiphaistos.forgechat.lan` | ForgeChat (LAN) | PC du réseau local, HTTP vers cette seule IP | téléphone d'un développeur, **jamais distribuée** |
| **APK DEV** | `preview` | `org.heiphaistos.forgechat.dev` | ForgeChat Dev | **choisi dans l'app** (écran « Serveur ») | les deux développeurs uniquement |
| **bêta** | `production` (APK) / `store` (AAB) | `org.heiphaistos.forgechat` | ForgeChat | **fixé à la compilation** (prod) | testeurs, puis Play Store |

- Icône orange « DEV » pour development, lan et APK DEV ; icône officielle pour la bêta.
- Les packages sont différents : les quatre variantes s'installent côte à côte sur un téléphone.
- **APK DEV** : onglet *Vous* → *Infos dev* (version, serveur, journaux masqués) → *Changer de serveur* :
  préréglage pré-prod, serveur local (IP du PC) ou adresse libre. HTTPS vers n'importe quel hôte ;
  HTTP **seulement** vers une IPv4 privée (10.x, 172.16–31.x, 192.168.x), 127.0.0.1 ou 10.0.2.2
  (vérifié dans l'app). Changer de serveur déconnecte complètement (session, cache, notifications).
- **Pourquoi la bêta n'a ni outils de dev ni choix de serveur** : un testeur ne doit jamais pouvoir
  pointer l'app vers un faux serveur (hameçonnage de ses identifiants), ni exporter des journaux, ni
  voir de trafic en clair. La bêta n'a donc : aucun panneau Infos dev, aucun écran Serveur, aucun
  journal de débogage, aucun trafic HTTP en clair, pas d'`expo-dev-client`, pas d'OTA, R8 actif,
  non débogable. Ce code est **retiré du bundle à la compilation** ; `__tests__/production-profile.test.ts`
  échoue si un élément de dev ou une URL non HTTPS apparaît dans le profil bêta, et
  `scripts/release-apk.sh` refuse un APK bêta qui en contiendrait.

## 2. Avant de distribuer la bêta : mettre à jour le serveur

La bêta a besoin de la version corrigée du serveur (notifications push, correctifs de sécurité,
IP réelle des clients derrière nginx). Ordre **obligatoire** : pré-prod, tests, puis prod.
Détails : `mobile/docs/DEPLOY.md` (fichiers à modifier, workflow de pré-prod) et
`SECURITY-FIXES-REVIEW.md` (revue des correctifs, transmis à part, non versionné).

1. **Sauvegarder la base** (sur le VPS, dossier de la prod puis de la pré-prod) :
   ```bash
   docker compose exec postgres pg_dump -U forgechat -Fc forgechat > forgechat-$(date +%F).dump
   ls -lh forgechat-*.dump
   ```
   Attendu : un fichier de plusieurs Mo, non vide.
2. **Pré-prod** : copie séparée (`/opt/forgechat-preprod`, projet compose `forgechat-preprod`, port et
   volumes distincts, `.env` propre avec un `JWT_SECRET` **différent** de la prod), branche `preprod`,
   workflow `deploy-preprod.yml` (contenu dans DEPLOY.md).
3. **Variables du `.env`** (VPS) : `PUSH_ENABLED=true`, `EXPO_ACCESS_TOKEN`, `STUN_URLS`, `TURN_*`, et
   `TRUSTED_PROXIES` = `127.0.0.1,::1,<passerelle du réseau Docker>` :
   ```bash
   docker network inspect <projet>_default --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}'
   ```
   Attendu : une adresse du type `172.x.0.1`. L'ajouter aussi dans l'`environment` du service `server`.
4. **nginx** : `X-Real-IP` / `X-Forwarded-For` sur `/invites/` et `/uploads/`, retirer
   `Cache-Control "public, immutable"` de `/uploads/`, `access_log off` sur `/ws`, et Cloudflare
   (`set_real_ip_from` + `real_ip_header`) si le proxy est actif. Puis :
   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```
   Attendu : `syntax is ok`, `test is successful`.
5. **Déployer la pré-prod** (push sur `preprod`, **jamais** sur `main`), puis :
   ```bash
   curl -fsS https://<pré-prod>/api/health
   ```
   Attendu : réponse 200. Les migrations s'appliquent au démarrage (voir les journaux du conteneur).
6. **Tester la pré-prod avec l'APK DEV** (§5) : connexion, messages, pièces jointes, appel, push.
7. **Prod** : sauvegarde (étape 1), push sur `main` (déclenche le déploiement automatique), puis
   `curl -fsS https://forgechat.heiphaistos.org/api/health` et l'audit des rôles :
   ```bash
   docker compose exec -T postgres psql -U forgechat -d forgechat < scripts/audit-roles.sql
   ```

**Liste de contrôle avant la bêta**

- [ ] sauvegardes prod et pré-prod faites et vérifiées
- [ ] pré-prod déployée, `/api/health` OK, testée avec l'APK DEV
- [ ] `TRUSTED_PROXIES` renseigné (prod et pré-prod) ; nginx rechargé sans erreur
- [ ] push : `PUSH_ENABLED=true`, `EXPO_ACCESS_TOKEN`, FCM configuré (DEPLOY.md, ligne Firebase)
- [ ] `STUN_URLS` et TURN configurés (coturn) : sans eux, les appels sont refusés (aucun STUN public
      par défaut) ; TURN indispensable en 4G
- [ ] prod déployée, `/api/health` OK, `audit-roles.sql` relu
- [ ] `assetlinks.json` servi avec l'empreinte SHA-256 de la clé de release (§4)

## 3. Pointer la bêta vers SON serveur

Le serveur de la bêta est **fixé à la compilation** (pas de choix dans l'app, voir §1) : changer de
serveur = **recompiler** et redistribuer.

**Où est l'URL** (à remplacer partout par `https://<ton-domaine>`, HTTPS obligatoire) :

| Fichier | Ligne | Rôle |
|---|---|---|
| `mobile/eas.json` | `build.production.env.FORGECHAT_API_URL` (l. 27) | source utilisée par EAS **et** par `scripts/build-apk-local.sh` |
| `mobile/app.config.ts` | l. 32 (valeur par défaut de `API_URL`) | si la variable est absente |
| `mobile/src/config/env.ts` | l. 46 (`BUILD_API_ORIGIN`) | repli au runtime |
| `mobile/__tests__/production-profile.test.ts` | test « identité finale » | le test vérifie l'URL attendue |
| `mobile/docs/TESTERS.md`, `mobile/deploy/well-known/*` | texte, App Links | domaine affiché / vérifié |

```bash
grep -rn "forgechat.heiphaistos.org" mobile --include=*.ts --include=*.tsx --include=*.json --include=*.md
```
Attendu après modification : plus aucune occurrence de l'ancien domaine (sauf historique voulu).
Puis `cd mobile && npm run check` → tous les tests passent.

### 3a. Recompiler avec EAS (recommandé)

1. Compte Expo (gratuit) : `npx eas-cli@latest login`.
2. Lier le projet : `cd mobile && npx eas-cli@latest init` → attendu : un `projectId` ajouté
   (renseigner `EAS_PROJECT_ID` dans l'environnement des builds, voir DEPLOY.md).
3. **Importer la clé de release existante** (ne jamais laisser EAS en générer une nouvelle pour la
   bêta) : `npx eas-cli@latest credentials -p android` → profil *production* → *Keystore* →
   *Set up a new keystore* → *Upload* : fichier `forgechat-release.keystore`, alias `forgechat-release`,
   même mot de passe pour le keystore et la clé (format PKCS12).
   Attendu : EAS affiche l'empreinte SHA-256 = celle du §4.
4. Build : `npx eas-cli@latest build -p android --profile production` (APK).
   Attendu : un lien de téléchargement de l'APK.

### 3b. Recompiler en local

Prérequis : Node 20+ et npm, JDK 17, Android SDK (build-tools, platform 36, NDK installé par
gradle), ~10 Go de RAM + swap libres.

```bash
cd mobile
npm ci
scripts/build-apk-local.sh production
```
La clé est lue dans `~/.config/forgechat-dev/release/` (ou `FORGECHAT_KEYSTORE` et
`FORGECHAT_KEYSTORE_PASSWORD_FILE`). Sans clé, le script s'arrête ; jamais de signature debug.
Attendu en fin de build : `APK : …/android/app/build/outputs/apk/release/app-release.apk` (10–20 min).

### 3c. Vérifier l'APK

```bash
mkdir -p ~/forgechat-releases/<version>
cp mobile/android/app/build/outputs/apk/release/app-release.apk ~/forgechat-releases/<version>/ForgeChat-<version>-beta.apk
mobile/scripts/release-apk.sh ~/forgechat-releases/<version>/ForgeChat-<version>-beta.apk <empreinte SHA-256 du §4>
unzip -p ~/forgechat-releases/<version>/ForgeChat-<version>-beta.apk assets/index.android.bundle | strings | grep -o 'https://<ton-domaine>' | head -1
```
Attendu : `OK …`, package `org.heiphaistos.forgechat`, clair `non`, certificat = empreinte du §4
(sinon le script échoue), et l'URL de **ton** domaine présente dans le bundle.

## 4. La clé de release

- **À quoi elle sert** : Android n'installe une mise à jour que si elle est signée par la **même clé**
  que l'app installée. La clé prouve aussi aux testeurs que l'APK vient de nous.
- **Ne jamais la perdre ni la changer** : sans elle, plus aucune mise à jour possible pour les
  utilisateurs existants (ils devraient désinstaller et perdre leurs données locales).
- Clé actuelle : keystore PKCS12, alias `forgechat-release`, RSA 4096, valide jusqu'en 2056.
  Empreintes publiques du certificat (à comparer, jamais secrètes) :
  - SHA-256 : `5E:A3:DB:62:2C:07:AA:69:54:D8:D9:2F:80:32:6E:24:60:A9:80:9C:94:80:5D:77:06:C0:0D:EC:E3:69:3C:BD`
  - SHA-1 : `E6:34:7B:A2:5B:B9:7B:A9:DA:E7:93:60:ED:04:38:1D:62:7A:B0:97`
- **La recevoir** : en main propre (clé USB), ou en fichier chiffré :
  ```bash
  age -p -o forgechat-release.keystore.age forgechat-release.keystore   # ou : gpg -c forgechat-release.keystore
  ```
  La phrase de passe du chiffrement **et** le mot de passe du keystore passent par **un autre canal**
  (appel, Signal), jamais dans le même message que le fichier.
- **La ranger** : `~/.config/forgechat-dev/release/` (droits 700 / fichiers 600), hors de tout dépôt :
  ```bash
  install -d -m 700 ~/.config/forgechat-dev/release
  age -d -o ~/.config/forgechat-dev/release/forgechat-release.keystore forgechat-release.keystore.age
  printf '%s\n' '<mot de passe>' > ~/.config/forgechat-dev/release/keystore.password   # éditeur de préférence, pas l'historique du shell
  chmod 600 ~/.config/forgechat-dev/release/*
  keytool -list -v -keystore ~/.config/forgechat-dev/release/forgechat-release.keystore -storepass:file ~/.config/forgechat-dev/release/keystore.password | grep SHA256
  ```
  Attendu : l'empreinte SHA-256 ci-dessus.
- **Sauvegarde** : deux copies chiffrées sur deux supports différents + fichier et mot de passe dans
  le gestionnaire de mots de passe. Jamais dans git (le `.gitignore` refuse `*.keystore`, `*.password`).
- **EAS** : l'importer (§3a) au lieu de laisser EAS générer une clé.
- **Play Store** : à la création de l'app, *Play App Signing* → « Utiliser ma propre clé » → exporter
  cette clé avec l'outil PEPK de Google. Ainsi la version Play Store met à jour la bêta installée.
  Mettre la même empreinte dans `mobile/deploy/well-known/assetlinks.json`.

## 5. L'APK DEV

1. **Installer** (téléphone en débogage USB) :
   ```bash
   adb devices                      # attendu : <id>  device
   adb -s <id> install -r ForgeChat-Dev-<version>.apk
   ```
   Attendu : `Success`. (Ou ouvrir l'APK sur le téléphone, comme un testeur.)
2. **Le pointer vers ton PC** (serveur lancé localement, `docker compose` ou `cargo run`) :
   1. Dans `.env` du serveur : `BIND_ADDR=0.0.0.0` (sinon il n'écoute que sur 127.0.0.1).
   2. Ouvrir le port **au réseau local seulement** :
      ```bash
      ip -4 addr show | grep inet                        # trouver l'IP du PC (ex. 192.168.x.y) et le réseau /24
      sudo ufw allow from <réseau-local>/24 to any port 8080 proto tcp
      ```
   3. Depuis le téléphone (même Wi-Fi) : `http://<IP-du-PC>:8080/api/health` dans le navigateur → `OK`.
   4. App → écran de connexion → *Changer* (ou *Vous* → *Infos dev* → *Changer de serveur*) →
      *Serveur local* : IP du PC, port 8080 → *Utiliser* → confirmer.
      Attendu : « Serveur (dev) : <IP>:8080 » sur l'écran de connexion.
   5. **Après les tests, remettre** : `BIND_ADDR=127.0.0.1`, puis
      `sudo ufw delete allow from <réseau-local>/24 to any port 8080 proto tcp`.
3. **Ou la pré-prod** : renseigner son URL (§ suivant) ou la saisir dans *Adresse libre* (`https://…`).
4. **Modifier le code de l'app** :
   ```bash
   cd mobile
   npm install
   cp .env.example .env.local       # FORGECHAT_API_URL=http://10.0.2.2:8080 (émulateur) ; APP_ENV=development
   npx expo run:android             # build de dev + Metro, sur l'émulateur ou le téléphone branché
   npm run check                    # typecheck, lint, tests : à faire passer avant chaque commit
   ```
   `FORGECHAT_API_URL` : serveur du build de dev (jamais committé : `.env.local` est ignoré).
   `APP_ENV` : `development` ici ; `preview` / `production` sont posés par les profils.
5. **Reconstruire l'APK DEV** (préréglage pré-prod facultatif, HTTPS) :
   ```bash
   cd mobile && scripts/build-apk-local.sh preview https://<pré-prod>
   ```
   (ou avec EAS : renseigner `build.preview.env.FORGECHAT_API_URL` dans `eas.json`, puis
   `npx eas-cli@latest build -p android --profile preview`).

## 6. Distribuer une bêta

1. **Numéro de version** : `version` dans `mobile/app.config.ts` (ex. `1.0.1`). Le `versionCode`
   doit augmenter à chaque APK (EAS : automatique ; local : `android.versionCode` dans `app.config.ts`).
2. **Build** : §3a ou §3b.
3. **Vérification + empreintes** : `scripts/release-apk.sh` (§3c) → met à jour `SHA256SUMS.txt`
   (SHA-256 du fichier + empreinte du certificat). Attendu : `OK`.
4. **Release GitHub** : dépôt « releases seulement », compte **pseudonyme** avec e-mail `noreply`
   (jamais d'e-mail personnel) ; joindre l'APK et `SHA256SUMS.txt`, coller l'empreinte du certificat
   dans le texte.
5. **Miroir SwissTransfer** : même APK, même `SHA256SUMS.txt` ; lien dans la release.
6. **Notes de version** : nouveautés, corrections, problèmes connus, rappel « messages non chiffrés
   de bout en bout ».
7. **Annonce** aux testeurs avec le lien de la release, l'empreinte du certificat, et le guide
   `mobile/docs/TESTERS.md` (installation, vérification, signalement de bugs).

Ne **jamais** distribuer l'APK DEV, lan ou development.

## 7. Mises à jour suivantes

- Une nouvelle bêta s'installe **par-dessus** l'ancienne (données conservées) si : même package,
  même clé (§4), `versionCode` supérieur.
- Pas d'OTA pour l'instant. Une phase « Mises à jour » est prévue : mises à jour OTA **signées**
  (expo-updates avec signature de code) et version minimale imposée par le serveur.

## 8. Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| « Conflit de signature » / « App non installée » | APK signé par une autre clé que l'app installée | vérifier l'empreinte (`apksigner verify --print-certs`) ; ne jamais distribuer un APK d'une autre clé ; pour un appareil de test : désinstaller puis réinstaller |
| APK DEV : « Le HTTP n'est autorisé que vers une IPv4 privée… » | adresse publique ou nom d'hôte en `http://` | utiliser `https://`, ou l'IP locale du PC |
| APK DEV : délai dépassé vers le PC | Wi-Fi invité / isolation des clients, autre réseau | même Wi-Fi « normal » que le PC ; tester `http://<IP>:8080/api/health` dans le navigateur du téléphone |
| idem | pare-feu | règle `ufw` du §5 ; `sudo ufw status` |
| idem | serveur sur 127.0.0.1 | `BIND_ADDR=0.0.0.0` puis relancer le serveur |
| « Appels indisponibles : le serveur ne fournit aucun serveur STUN/TURN » | `STUN_URLS` et `TURN_*` absents du `.env` du serveur | les renseigner (coturn, DEPLOY.md), redémarrer le serveur ; en local : `STUN_URLS=stun:127.0.0.1:3478` suffit pour des appels sur le même réseau |
| `adb devices` vide / `unauthorized` | débogage USB inactif ou non autorisé | Options développeur → Débogage USB ; accepter l'empreinte de l'ordinateur ; câble données |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | même package, autre clé | voir première ligne |
| build local arrêté « Swap > 80 % » | mémoire insuffisante | fermer émulateur / navigateur / autres builds et relancer |

## 9. Limites connues

- **Messages non chiffrés de bout en bout** : chiffrés en transit (HTTPS/WSS), lisibles par le
  serveur. Le chiffrement de bout en bout est en conception (aucun code tant qu'il n'est pas validé).
- **Pas d'iOS** : Android uniquement.
- Notifications push : nécessitent la configuration Firebase/EAS (DEPLOY.md) ; non testables sur les
  builds locaux sans cette configuration.
