# ForgeChat Mobile (Android et iPhone)

Application native ForgeChat pour **Android** et **iPhone/iPad**, construite avec **React Native + Expo
(SDK 57)** et **TypeScript strict**. Elle parle au même serveur que le web et les applications de bureau,
avec le même protocole temps réel : un utilisateur mobile discute et **s'appelle** avec un utilisateur
web ou bureau.

**Application créée par [aerwx](https://github.com/aerwx).** ForgeChat (serveur, web, bureau) par Heiphaistos.

## Télécharger

| Plateforme | Où | Mises à jour |
|---|---|---|
| Android 7+ | [forgechat.heiphaistos.org/telecharger/android](https://forgechat.heiphaistos.org/telecharger/android) ou les releases de ce dépôt | automatiques : l'app interroge `forgechat.heiphaistos.org/desktop/mobile.json` une fois par jour |
| iPhone / iPad | [forgechat.heiphaistos.org/telecharger/iphone](https://forgechat.heiphaistos.org/telecharger/iphone) : web app, ou IPA via AltStore / SideStore (identifiant Apple gratuit) | source AltStore `https://forgechat.heiphaistos.org/desktop/altstore.json` |

- **APK** signé avec la clé ForgeChat, certificat `CN=Heiphaistos & aerwx`,
  SHA-256 `3C:5B:A3:B3:41:27:54:F7:55:AD:0F:85:D9:BD:FA:92:FB:10:F4:4C:ED:C6:80:A4:4F:41:59:D9:B5:1E:E2:AA`.
- **IPA** non signée (pas d'App Store) : AltStore, SideStore ou Sideloadly la signent avec votre propre
  identifiant Apple. Construite et compilée en CI (Xcode 26.4+), **pas encore testée sur un iPhone réel**.
- Construction, signature et publication automatiques : tag `mobile-vX.Y.Z` sur le dépôt principal
  [Heiphaistos/ForgeChat](https://github.com/Heiphaistos/ForgeChat) (`.github/workflows/applications.yml`).

> Documentation complémentaire : [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) ·
> [`docs/SECURITY.md`](docs/SECURITY.md) · [`docs/SERVER_CHANGES.md`](docs/SERVER_CHANGES.md)

---

## Fonctionnalités

| Domaine | Mobile |
|---|---|
| Compte | Connexion (+ 2FA TOTP / codes de secours), inscription, déconnexion de cet appareil ou de tous |
| Serveurs | Liste (rail), salons par catégorie, non-lus, créer / rejoindre (code ou lien), inviter, membres |
| Chat (salons, DM, groupes) | Temps réel, historique infini, répondre, modifier, supprimer, réactions, épingler, signaler, copier, mentions, indicateur de saisie, Markdown (gras, italique, barré, code, citations, spoilers, liens) |
| Barre de saisie | Emoji (catégories du web, récents, emojis du serveur), stickers (globaux + du serveur), réponses rapides (sur l'appareil), messages éphémères (salons : 5 min → 7 j), messages vocaux (2 min). GIF : du téléphone (restent animés), du serveur, et recherche KLIPY via le serveur (si le serveur a le patch) |
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
