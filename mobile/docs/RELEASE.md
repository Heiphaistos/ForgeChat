# Publication de l'app mobile

## Les quatre versions

| Version | `APP_ENV` / profil EAS | Package | Nom | Serveur | Pour qui |
|---|---|---|---|---|---|
| development | `development` | `org.heiphaistos.forgechat.development` | ForgeChat (development) | local (Metro, émulateur) | développeurs |
| lan | `lan` (build local, pas EAS) | `org.heiphaistos.forgechat.lan` | ForgeChat (LAN) | PC du réseau local, HTTP vers cette IP seulement | téléphone du développeur, **jamais distribuée** |
| dev-apk | `preview` | `org.heiphaistos.forgechat.dev` | ForgeChat Dev | **pré-prod** en HTTPS | les deux développeurs uniquement |
| client-apk | `production` (APK) / `store` (AAB) | `org.heiphaistos.forgechat` | ForgeChat | **prod** `https://forgechat.heiphaistos.org` | bêta publique, puis Play Store |

- Icônes : variante orange « DEV » pour development, lan et dev-apk ; icône officielle pour le
  client-apk (`scripts/generate-icons.mjs`).
- Version lisible commune (`version` dans `app.config.ts`) ; `versionCode` incrémenté par EAS
  (`appVersionSource: remote`, `autoIncrement`).
- dev-apk : panneau « Infos dev » (version, environnement, serveur, export des journaux masqués).
- client-apk : **aucune** fonction de dev. Pas de panneau d'infos, pas de choix de serveur, pas de
  journaux de débogage (`__DEV__` faux, tampon de journaux compilé hors production seulement), pas
  de trafic en clair, pas d'`expo-dev-client` (exclu de l'autolinking par `scripts/eas-build-pre-install.js`),
  pas d'OTA (`expo-updates` absent), non débogable, R8 actif. Vérifié par
  `__tests__/production-profile.test.ts` ; le code du panneau est retiré du bundle à la compilation
  (`EXPO_PUBLIC_APP_ENV`, vérifié en cherchant ses textes dans le bundle Hermes exporté).
- À vérifier au premier build EAS de production : l'app démarre bien sans `expo-dev-client` lié, et
  l'audit APK (phase « audit final ») ne trouve aucune classe `expo.modules.devlauncher` / `devmenu`.

## Construire

```bash
cd mobile
npx eas-cli@latest build -p android --profile preview      # dev-apk (échoue tant que l'URL pré-prod vaut REMPLACER)
npx eas-cli@latest build -p android --profile production   # client-apk (APK bêta)
npx eas-cli@latest build -p android --profile store        # AAB pour le Play Store (plus tard)
```

L'URL de la pré-prod se renseigne dans `eas.json` (`build.preview.env.FORGECHAT_API_URL`) : voir
`docs/DEPLOY.md`.

## Signature

- **Jamais de clé debug pour un APK distribué.** Seul l'APK lan (jamais distribué) est signé avec la
  clé debug.
- Les clés du dev-apk et du client-apk sont **gérées par EAS** (une par package).
- **Continuité client-apk → Play Store** : un APK bêta installé ne peut être mis à jour par la version
  Play Store que si les deux sont signés par la **même clé**. La clé de production EAS doit donc devenir
  la **clé de signature de l'application** dans Play App Signing : à la création de l'app dans la Play
  Console, choisir « Utiliser ma propre clé » (exporter la clé EAS avec l'outil PEPK de Google). Sans
  ça, Google signerait avec une autre clé et les testeurs devraient désinstaller la bêta (perte des données
  locales de l'app).
- **Sauvegarde de la clé de production** (à faire dès le premier build) :
  1. `npx eas-cli@latest credentials -p android` → profil production → *Keystore* → *Download* ;
  2. ranger le fichier `.jks` **et** ses mots de passe dans le gestionnaire de mots de passe ;
  3. deux copies, sur deux supports différents. Perdre cette clé = ne plus jamais pouvoir mettre à jour
     l'app pour les utilisateurs existants.
- Empreinte du certificat de signature d'un APK (à publier avec chaque release) :

  ```bash
  ~/Android/Sdk/build-tools/<version>/apksigner verify --print-certs ForgeChat.apk | grep SHA-256
  ```

## Publier une bêta (client-apk)

1. Build EAS `production`, télécharger l'APK.
2. Vérifier : package `org.heiphaistos.forgechat`, non débogable, pas de cleartext, empreinte du
   certificat = celle déjà publiée (même clé qu'avant).
3. Calculer le SHA-256 du fichier (`sha256sum`).
4. Release GitHub (dépôt « releases seulement », compte pseudonyme avec e-mail noreply) : APK, empreinte
   du certificat, SHA-256, notes de version ; miroir SwissTransfer.
5. **Ne jamais distribuer** les versions development, lan ni le dev-apk.

## Google Play : déclarations obligatoires

### Service au premier plan « media projection » (partage d'écran)

Le partage d'écran (appel vidéo 1:1 et salons vocaux) utilise MediaProjection. Depuis Android 14,
la capture exige un service au premier plan de type `mediaProjection` :

- permissions `FOREGROUND_SERVICE` et `FOREGROUND_SERVICE_MEDIA_PROJECTION` (ajoutées par
  `plugins/withScreenShare.js`) ;
- service `com.oney.WebRTCModule.MediaProjectionService` (fourni par react-native-webrtc).

Google Play demande une **déclaration des services au premier plan** dans la Play Console
(Contenu de l'application → Services au premier plan) pour ce type :

- usage : « partage d'écran en direct avec les autres participants d'un appel ou d'un salon
  vocal, lancé uniquement à la demande de l'utilisateur » ;
- **vidéo de démonstration** demandée : montrer l'avertissement avant le partage, le dialogue
  système, la notification pendant la capture et l'arrêt ;
- la capture s'arrête quand l'utilisateur appuie sur « Arrêter » (bandeau de l'app ou
  notification système), raccroche ou quitte le salon.

Sans cette déclaration, la mise en ligne sur le Play Store est refusée. Les APK distribués hors
Play Store (bêta) ne sont pas concernés.
