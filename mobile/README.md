# ForgeChat Mobile (Android & iOS)

Application native ForgeChat pour Android et iOS, construite avec **React Native + Expo (SDK 57)** et
**TypeScript strict**. Elle parle au même backend Rust que le web et le desktop, avec le même protocole
temps réel : un utilisateur mobile peut discuter et **s'appeler** avec un utilisateur web/desktop.

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
| Appels | Appels 1:1 audio & vidéo (WebRTC, compatibles web/desktop), haut-parleur, caméra avant/arrière, appel entrant même app fermée (push) |
| Salons vocaux | Rejoindre (y compris protégé par mot de passe), micro, sourdine, haut-parleur, vidéo des autres |
| Notifications | Push DM / groupes / mentions / demandes d'ami / appels, aperçu du contenu optionnel |
| Sécurité | Verrouillage biométrique, masquage dans le sélecteur d'apps, sessions actives + révocation, changement de mot de passe |
| Liens | `forgechat://invite/CODE`, liens universels `https://<hôte>/invite/CODE` et `/friend-invite/CODE` |

Pas encore sur mobile (disponible sur web/desktop) : forums, scènes (stage), fils (threads), sondages,
administration de serveur (rôles, automod, webhooks…), partage d'écran, configuration de la 2FA.

---

## Démarrage rapide

Prérequis : Node 20+, un compte [Expo](https://expo.dev) (gratuit) et soit Android Studio / Xcode en
local, soit les builds cloud EAS (pas besoin de Mac pour iOS).

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
npx expo run:ios          # macOS + Xcode
```

**Option B — build cloud (EAS)**

```bash
npx eas-cli@latest login
npx eas-cli@latest init                          # crée le projet → copier l'id dans EAS_PROJECT_ID
npx eas-cli@latest build --profile development --platform android   # (ou ios)
npm start                                        # sert le JS au development build installé
```

**Backend local** : `FORGECHAT_API_URL=http://10.0.2.2:8080` (émulateur Android) ou
`http://localhost:8080` (simulateur iOS). Le HTTP en clair n'est accepté qu'avec `APP_ENV=development`.

---

## Builds de production

```bash
npx eas-cli@latest build --profile production --platform all
npx eas-cli@latest submit --profile production --platform all
```

Les variables de `.env.local` ne sont pas envoyées aux builds cloud : définis-les côté EAS
(`npx eas-cli@latest env:create --name FORGECHAT_API_URL --value https://… --environment production`,
idem pour `EAS_PROJECT_ID`).

Le profil `production` impose : API en `https://` (le build échoue sinon), trafic en clair interdit au
niveau OS Android, minification R8, pas de sauvegarde Android des données de l'app.

### Notifications push (une fois)

1. **Serveur** : appliquer les changements décrits dans [`docs/SERVER_CHANGES.md`](docs/SERVER_CHANGES.md)
   (migration `061_push_devices.sql` incluse, jouée automatiquement au démarrage).
2. **Android** : créer un projet Firebase, puis `npx eas-cli@latest credentials` → *Google Service Account
   Key for FCM V1*.
3. **iOS** : `npx eas-cli@latest credentials` → laisser EAS générer la *Push Key* APNs.
4. **Recommandé** : activer *Enhanced Push Security* sur expo.dev et renseigner `EXPO_ACCESS_TOKEN` dans le
   `.env` du serveur.

### Liens universels (une fois)

Remplir `deploy/well-known/apple-app-site-association` (Team ID Apple) et
`deploy/well-known/assetlinks.json` (empreinte SHA-256 affichée par `eas credentials`), les servir sous
`https://<hôte>/.well-known/` et ajouter le bloc de `deploy/nginx-well-known.conf` à nginx.

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
