import type { ExpoConfig, ConfigContext } from 'expo/config'

import { googleServicesFile } from './plugins/googleServices.js'
import { distributedServerConfig } from './plugins/serverConfig.js'
import { versionCodeOf } from './plugins/versionCode.js'
import withAppIcons from './plugins/withAppIcons.js'
import withLanCleartext from './plugins/withLanCleartext.js'
import withCertPinning from './plugins/withCertPinning.js'
import withPictureInPicture from './plugins/withPictureInPicture.js'
import withReleaseSigning from './plugins/withReleaseSigning.js'
import withScreenShare from './plugins/withScreenShare.js'
import withStripBuildPaths from './plugins/withStripBuildPaths.js'
import withTransparentNavBar from './plugins/withTransparentNavBar.js'
import withoutDevClientScheme from './plugins/withoutDevClientScheme.js'

/**
 * Configuration Expo dynamique.
 *
 * Toutes les valeurs sensibles à l'environnement passent par des variables
 * d'environnement (voir `.env.example`) — rien de secret n'est embarqué dans le
 * binaire : l'app ne connaît que l'URL publique de l'API.
 *
 * Versions (APP_ENV ↔ profil EAS, voir eas.json et docs/RELEASE.md) :
 *  - development : émulateur + Metro, local ;
 *  - lan         : téléphone de test sur le réseau local, jamais distribuée ;
 *  - preview     : « APK DEV », ForgeChat Dev, pour les deux développeurs : serveur choisi dans l'app
 *                  (écran « Serveur » des Infos dev) ; préréglage pré-prod en HTTPS fixé ici,
 *                  éventuellement vide ;
 *  - production  : « client-apk » (APK bêta publique, AAB Play Store plus tard), ForgeChat,
 *                  prod, AUCUNE fonction de dev (vérifié par __tests__/production-profile.test.ts).
 */

type AppEnv = 'development' | 'lan' | 'preview' | 'production'
const APP_ENV = (process.env.APP_ENV ?? 'development') as AppEnv
if (!['development', 'lan', 'preview', 'production'].includes(APP_ENV)) {
  throw new Error(`APP_ENV inconnu : ${APP_ENV}`)
}
// Adresse du serveur : TOUJOURS fournie au build, AUCUNE adresse par défaut cachée dans l'app.
//  - development : mobile/.env.local (émulateur : http://10.0.2.2:8080) ;
//  - lan : IP du PC (réseau local), voir plus bas ;
//  - preview (APK DEV) : pré-prod facultative, sinon choisie dans l'app (écran « Serveur ») ;
//  - production (bêta) : obligatoire, https:// vers un vrai domaine (plugins/serverConfig.js).
// FORGECHAT_LIVEKIT_URL (facultatif) : serveur LiveKit s'il n'est pas sur le même hôte.
const RAW_API_URL = (process.env.FORGECHAT_API_URL ?? '').trim()
if ((APP_ENV === 'development' || APP_ENV === 'lan') && !RAW_API_URL) {
  throw new Error(`FORGECHAT_API_URL manquant pour APP_ENV=${APP_ENV} : voir mobile/.env.example`)
}
const DISTRIBUTED =
  APP_ENV === 'preview' || APP_ENV === 'production'
    ? distributedServerConfig(APP_ENV, RAW_API_URL, process.env.FORGECHAT_LIVEKIT_URL)
    : null
const API_URL = DISTRIBUTED ? DISTRIBUTED.apiUrl : RAW_API_URL
const LIVEKIT_HOST = DISTRIBUTED?.livekitHost ?? null
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID
// Push Android (FCM) : google-services.json hors dépôt (plugins/googleServices.js).
const GOOGLE_SERVICES_JSON = googleServicesFile(APP_ENV, process.env.GOOGLE_SERVICES_JSON)
// Identifiant FINAL de l'app publique (Play Store) : jamais configurable.
const BUNDLE_ID = 'org.heiphaistos.forgechat'
const PACKAGES: Record<AppEnv, string> = {
  development: `${BUNDLE_ID}.development`,
  lan: `${BUNDLE_ID}.lan`,
  preview: `${BUNDLE_ID}.dev`,
  production: BUNDLE_ID,
}

// Le code des outils de dev est retiré du bundle d'après EXPO_PUBLIC_APP_ENV (inliné à la
// compilation) : il doit être cohérent avec APP_ENV, et explicite en production.
const PUBLIC_ENV = process.env.EXPO_PUBLIC_APP_ENV
if ((PUBLIC_ENV !== undefined && PUBLIC_ENV !== APP_ENV) || (APP_ENV === 'production' && PUBLIC_ENV !== 'production')) {
  throw new Error(`EXPO_PUBLIC_APP_ENV (${PUBLIC_ENV ?? 'absent'}) doit valoir APP_ENV (${APP_ENV})`)
}

// LAN : HTTP permis seulement vers une IPv4 privée (sinon lanCleartextHost fait échouer le build).
// APK DEV et bêta : HTTPS imposé par distributedServerConfig. (Le client revérifie au runtime : src/config/env.ts.)
const LAN_CLEARTEXT_HOST = APP_ENV === 'lan' ? withLanCleartext.lanCleartextHost(API_URL) : null

// Icônes (../scripts/gen-brand-icons.py, logo 3D officiel) : variante orange « DEV » pour tout ce
// qui n'est pas la version publique, pour ne jamais confondre les apps sur un téléphone.
const ASSETS = APP_ENV === 'production' ? './assets' : './assets/dev'

const APP_NAMES: Record<AppEnv, string> = {
  development: 'ForgeChat (development)',
  lan: 'ForgeChat (LAN)',
  preview: 'ForgeChat Dev',
  production: 'ForgeChat',
}

const apiHost = API_URL ? new URL(API_URL).host : null

export default (ctx: ConfigContext): ExpoConfig => {
  // Partage d'écran (MediaProjection) : permissions et service au premier plan, tous profils.
  // Pas de voile blanc sous la barre de navigation (thèmes sombres).
  // Image dans l'image pendant un appel vidéo.
  // Icônes d'application alternatives (Apparence → Icône de l'app), les 50 variantes du web.
  const expoConfig = withAppIcons(withPictureInPicture(withTransparentNavBar(withScreenShare(buildConfig(ctx)))))
  // LAN : network_security_config limitant le HTTP en clair à l'IP du serveur de dev.
  if (APP_ENV === 'lan') return withLanCleartext(expoConfig, { host: LAN_CLEARTEXT_HOST })
  // APK distribués (APK DEV, bêta) : signés avec la clé de release hors dépôt, jamais la clé debug.
  // (et sans chemin de la machine de build dans les bibliothèques natives).
  // Applis distribuées : autorités de certification du serveur épinglées (plugins/withCertPinning.js).
  if (APP_ENV === 'production') {
    return withCertPinning(withoutDevClientScheme(withStripBuildPaths(withReleaseSigning(expoConfig))), { apiUrl: API_URL })
  }
  if (APP_ENV === 'preview') return withCertPinning(withStripBuildPaths(withReleaseSigning(expoConfig)), { apiUrl: API_URL })
  return expoConfig
}

// Version publique : la changer ici (et dans package.json) pour chaque nouvelle bêta.
const VERSION = '1.36.0'

const buildConfig = ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: APP_NAMES[APP_ENV],
  slug: 'forgechat',
  scheme: 'forgechat',
  version: VERSION,
  orientation: 'portrait',
  icon: `${ASSETS}/icon.png`,
  userInterfaceStyle: 'dark',
  backgroundColor: '#1e1f22',
  ios: {
    bundleIdentifier: PACKAGES[APP_ENV],
    supportsTablet: true,
    associatedDomains: apiHost ? [`applinks:${apiHost}`] : [],
    infoPlist: {
      NSCameraUsageDescription: 'ForgeChat utilise la caméra pour les appels vidéo, pour envoyer des photos et pour scanner le code de sécurité d’un contact.',
      NSMicrophoneUsageDescription: 'ForgeChat utilise le micro pour les appels et les salons vocaux.',
      NSPhotoLibraryUsageDescription: 'ForgeChat accède à tes photos uniquement quand tu choisis d’en envoyer.',
      // Maintient l'audio d'un appel en cours quand l'app passe en arrière-plan.
      UIBackgroundModes: ['audio', 'remote-notification'],
      ITSAppUsesNonExemptEncryption: false,
      // ATS reste actif (aucune exception) : tout le trafic est forcé en HTTPS/TLS 1.2+.
    },
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyCollectedDataTypes: [],
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
          NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
        },
      ],
    },
  },
  android: {
    package: PACKAGES[APP_ENV],
    // Builds locaux ; EAS gère son propre compteur (eas.json : appVersionSource remote).
    versionCode: versionCodeOf(VERSION),
    ...(GOOGLE_SERVICES_JSON ? { googleServicesFile: GOOGLE_SERVICES_JSON } : {}),
    adaptiveIcon: {
      backgroundColor: '#1e1f22',
      foregroundImage: `${ASSETS}/android-icon-foreground.png`,
      backgroundImage: `${ASSETS}/android-icon-background.png`,
      monochromeImage: `${ASSETS}/android-icon-monochrome.png`,
    },
    // Pas de sauvegarde cloud/adb des données de l'app (tokens, préférences).
    allowBackup: false,
    predictiveBackGestureEnabled: false,
    permissions: [
      'android.permission.CAMERA',
      'android.permission.RECORD_AUDIO',
      'android.permission.MODIFY_AUDIO_SETTINGS',
      'android.permission.BLUETOOTH_CONNECT',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.USE_BIOMETRIC',
      'android.permission.WAKE_LOCK',
    ],
    blockedPermissions: [
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      // Ajoutée par expo-screen-capture pour la détection des captures (inutilisée : l'app ne fait
      // que les bloquer). Le sélecteur de photos du système n'en a pas besoin (src/lib/photoAccess.ts).
      // Ne PAS bloquer DETECT_SCREEN_CAPTURE : ce module l'utilise toujours sur Android 14+.
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_MEDIA_VIDEO',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_PHONE_STATE',
    ],
    // App Links : uniquement vers un vrai domaine (pas vers l'IP du profil LAN, ni sans serveur fixé).
    intentFilters: APP_ENV === 'lan' || !apiHost ? [] : [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          { scheme: 'https', host: apiHost, pathPrefix: '/invite/' },
          { scheme: 'https', host: apiHost, pathPrefix: '/friend-invite/' },
          // Lien du mail « mot de passe oublié » (FRONTEND_URL/reset-password#token=…), si même hôte.
          { scheme: 'https', host: apiHost, path: '/reset-password' },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  plugins: [
    'expo-router',
    ['expo-secure-store', { faceIDPermission: 'Déverrouiller ForgeChat avec Face ID.' }],
    ['expo-local-authentication', { faceIDPermission: 'Déverrouiller ForgeChat avec Face ID.' }],
    [
      'expo-notifications',
      // Petite icône blanche de la barre d'état (Android n'en utilise que l'alpha).
      { icon: `${ASSETS}/notification-icon.png`, color: '#5865f2', defaultChannel: 'messages' },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'ForgeChat accède à tes photos uniquement quand tu choisis d’en envoyer.',
        // Mêmes textes que le plugin WebRTC : ces plugins écrivent les mêmes clés Info.plist
        // et ne doivent surtout pas retirer RECORD_AUDIO (indispensable aux appels).
        cameraPermission: 'ForgeChat utilise la caméra pour les appels vidéo, pour envoyer des photos et pour scanner le code de sécurité d’un contact.',
        microphonePermission: 'ForgeChat utilise le micro pour les appels et les salons vocaux.',
      },
    ],
    // Média des appels et salons vocaux : SFU LiveKit. Le module natif du plugin initialise LiveKit
    // au démarrage (audio « communication ») et active le service au premier plan du partage d'écran.
    ['@livekit/react-native-expo-plugin', { android: { audioType: 'communication', enableScreenShareService: true } }],
    [
      '@config-plugins/react-native-webrtc',
      {
        cameraPermission: 'ForgeChat utilise la caméra pour les appels vidéo, pour envoyer des photos et pour scanner le code de sécurité d’un contact.',
        microphonePermission: 'ForgeChat utilise le micro pour les appels et les salons vocaux.',
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          // Interdit tout trafic HTTP en clair au niveau OS (en plus du contrôle applicatif) — sauf
          // development et APK DEV (preview), où le serveur local se choisit dans l'app : le contrôle
          // applicatif (src/config/serverUrl.ts) y limite le HTTP aux IPv4 privées, 127.0.0.1, 10.0.2.2.
          // JAMAIS en production (__tests__/production-profile.test.ts).
          usesCleartextTraffic: APP_ENV === 'development' || APP_ENV === 'preview',
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
          // Règles R8 de la pile WebRTC de LiveKit (SDK « android-prefixed » : paquets livekit.org.*).
          // Les règles fournies par @livekit/react-native-webrtc gardent org.jni_zero mais pas
          // livekit.org.jni_zero : sans la 2ᵉ ligne, R8 retire JniInit et l'app plante au démarrage
          // (JNI_OnLoad de libjingle → SIGILL). Vérifié par scripts/release-apk.sh.
          extraProguardRules: ['-keep class livekit.org.webrtc.** { *; }', '-keep class livekit.org.jni_zero.** { *; }'].join('\n'),
        },
      },
    ],
    'expo-web-browser',
    'expo-font',
    ['expo-splash-screen', { backgroundColor: '#1e1f22', image: `${ASSETS}/splash-icon.png`, imageWidth: 160 }],
    'expo-image',
    'expo-video',
    // Lecture des pièces jointes audio et enregistrement des messages vocaux (permission demandée au
    // premier enregistrement). Même texte micro que WebRTC (clés Info.plist partagées).
    // Pas de lecture en arrière-plan : évite le service de premier plan « mediaPlayback » et ses
    // permissions (FOREGROUND_SERVICE_MEDIA_PLAYBACK), à justifier auprès de Google Play.
    // Scan du QR code de sécurité d'un contact (amélioration n° 11) ; pas de micro pour ce module.
    ['expo-camera', { cameraPermission: 'ForgeChat utilise la caméra pour les appels vidéo, pour envoyer des photos et pour scanner le code de sécurité d’un contact.', recordAudioAndroid: false, barcodeScannerEnabled: true }],
    [
      'expo-audio',
      { microphonePermission: 'ForgeChat utilise le micro pour les appels, les salons vocaux et les messages vocaux.', enableBackgroundPlayback: false },
    ],
  ],
  experiments: { typedRoutes: true },
  extra: {
    apiUrl: API_URL,
    appEnv: APP_ENV,
    ...(LIVEKIT_HOST ? { livekitHost: LIVEKIT_HOST } : {}),
    ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
  },
})
