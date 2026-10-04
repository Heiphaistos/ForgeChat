# ForgeChat Mobile (Android)

Application native ForgeChat pour **Android**, construite avec **React Native + Expo (SDK 57)** et
**TypeScript strict**. Elle parle au même backend Rust que le web et le desktop, avec le même protocole
temps réel : un utilisateur mobile peut discuter et **s'appeler** avec un utilisateur web/desktop.

> **Android uniquement pour l'instant.** Grâce à Expo, le code est en théorie compatible iOS, mais
> **aucune version iOS n'a été construite ni testée** (pas de build, pas de compte Apple, pas de
> configuration push APNs). Les mentions d'iOS dans le code et la doc décrivent ce qui est prévu, pas
> une version qui existe.

> Documentation complémentaire : [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) ·
> [`docs/SECURITY.md`](docs/SECURITY.md) · [`docs/SERVER_CHANGES.md`](docs/SERVER_CHANGES.md)

---

## Fonctionnalités

| Domaine | Mobile |
|---|---|
| Compte | Connexion (+ 2FA TOTP / codes de secours), inscription, déconnexion de cet appareil ou de tous |
| Serveurs | Liste (rail), salons par catégorie, non-lus, créer / rejoindre (code ou lien), inviter, membres |
| Chat (salons, DM, groupes) | Temps réel, historique infini, répondre, modifier, supprimer, réactions, épingler, signaler, copier, mentions, indicateur de saisie, Markdown (gras, italique, barré, code, citations, spoilers, liens) |
| Pièces jointes | Photos / vidéos / caméra / fichiers, aperçu, visionneuse plein écran (métadonnées EXIF/GPS retirées) |
| Messages privés | Liste des conversations, DM 1:1, groupes, quitter un groupe |
| Amis | En ligne / tous / en attente / bloqués, ajouter par pseudo, accepter, refuser, retirer, bloquer |
| Appels | Appels 1:1 audio & vidéo via LiveKit (compatibles web/desktop), partage d'écran, haut-parleur, caméra avant/arrière |
| Salons vocaux | Rejoindre (y compris protégé par mot de passe), micro, sourdine, haut-parleur, vidéo et partage d'écran |
| Notifications | **Prochaine version** (pas de push dans la 1.0) : DM, groupes, mentions, appels manqués, aperçu du contenu optionnel. Le code est prêt, désactivé tant que le build n'a pas de projet Firebase/EAS |
| Sécurité | Verrouillage biométrique, masquage dans le sélecteur d'apps, sessions actives + révocation, changement de mot de passe |
| Liens | `forgechat://invite/CODE`, liens universels `https://<hôte>/invite/CODE` et `/friend-invite/CODE` |

Pas encore sur mobile (disponible sur web/desktop) : forums, scènes (stage), fils (threads), sondages,
administration de serveur (rôles, automod, webhooks…), configuration de la 2FA.

---

## Démarrage rapide

Prérequis : Node 20+, JDK 17 et le SDK Android (Android Studio), ou les builds cloud EAS avec un
compte [Expo](https://expo.dev) (gratuit).

```bash
cd mobile
npm install
cp .env.example .env.local        # puis adapter FORGECHAT_API_URL, EAS_PROJECT_ID…
```

> L'app utilise des modules natifs (WebRTC, Keychain, biométrie…) : elle ne tourne **pas** dans
> Expo Go. Il faut un *development build* (une seule fois, puis rechargement à chaud du JS).

**Option A — build local**

```bash
npx expo run:android      # émulateur ou téléphone branché
```

**Option B — build cloud (EAS)**

```bash
npx eas-cli@latest login
npx eas-cli@latest init                          # crée le projet → copier l'id dans EAS_PROJECT_ID
npx eas-cli@latest build --profile development --platform android
npm start                                        # sert le JS au development build installé
```

**Backend local** : `FORGECHAT_API_URL=http://10.0.2.2:8080` (émulateur Android). Le HTTP en clair
n'est accepté qu'avec `APP_ENV=development`.

---

## Builds de production et distribution

La bêta Android est distribuée **uniquement** par les releases d'un dépôt GitHub public (pas de Play
Store pour l'instant). Une commande : build signé, vérification, release en **brouillon** à relire et
publier à la main :

```bash
scripts/release-beta.sh --server https://ton.domaine --repo <propriétaire>/<dépôt>
```

Détails (clé de signature, APK DEV, EAS) : [`docs/MAINTAINER.md`](docs/MAINTAINER.md). Guide des
utilisateurs : [`docs/INSTALLER.md`](docs/INSTALLER.md).

Le profil `production` impose : API en `https://` (le build échoue sinon), trafic en clair interdit au
niveau OS Android, minification R8, pas de sauvegarde Android des données de l'app.

### Notifications push (plus tard, pas dans la 1.0)

1. **Serveur** : routes du push mobile (voir [`docs/SERVER_CHANGES.md`](docs/SERVER_CHANGES.md)) et
   `PUSH_ENABLED=true`.
2. **Android** : projet Firebase (`google-services.json`) et clé de compte de service FCM V1 chargée
   dans EAS : [`docs/MAINTAINER.md`](docs/MAINTAINER.md) §4 bis.
3. **iOS** : non configuré (aucune version iOS).

### Liens universels (une fois)

Remplir `deploy/well-known/assetlinks.json` (empreinte SHA-256 du certificat de la clé de release,
`docs/MAINTAINER.md` §4), le servir sous `https://<hôte>/.well-known/` et ajouter le bloc de
`deploy/nginx-well-known.conf` à nginx. (`apple-app-site-association` : pour une future version iOS.)

---

## Qualité

```bash
npm run check        # typecheck (app + tests) + lint + tests unitaires
npm run doctor       # expo-doctor
```

Les tests couvrent les parties sensibles : masquage des secrets dans les logs, parseur Markdown (pas de
HTML, liens http(s) uniquement, bornes anti-DoS), validation des URL et des médias, décodage JWT,
encodage des chemins d'API, validation des formulaires et fichiers, cache de messages
(optimiste / temps réel / dédoublonnage) et adaptateurs de formats serveur.

---

## Structure

```
mobile/
├── app.config.ts          # config Expo dynamique (env, permissions, durcissement)
├── eas.json               # profils de build EAS
├── deploy/                # fichiers .well-known + snippet nginx (liens universels)
├── docs/                  # architecture, sécurité, changements serveur
├── __tests__/             # tests unitaires (Jest)
└── src/
    ├── app/               # écrans (Expo Router, routage par fichiers)
    │   ├── (auth)/        # connexion, inscription
    │   ├── (app)/         # zone connectée : onglets, conversations, appels, réglages
    │   ├── invite/        # lien d'invitation serveur (public)
    │   └── friend-invite/ # lien d'invitation ami (public)
    ├── api/               # endpoints REST typés, un fichier par domaine
    ├── config/            # configuration runtime (URL, limites)
    ├── features/          # chat (vue, composer, cache, adaptateurs), serveurs, amis
    ├── lib/               # http, websocket, tokens, logger, markdown, liens, validation
    ├── services/          # push, cycle de vie, médias/audio, liaisons temps réel
    ├── stores/            # état global (Zustand) : auth, appels, vocal, verrou, réglages…
    ├── components/        # composants UI partagés
    ├── theme/             # couleurs, espacements, typo
    └── types/             # modèles de données
```
