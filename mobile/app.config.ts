import type { ExpoConfig, ConfigContext } from 'expo/config'

import withLanCleartext from './plugins/withLanCleartext.js'
import withScreenShare from './plugins/withScreenShare.js'

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
 *  - preview     : « dev-apk », ForgeChat Dev, pré-prod en HTTPS, pour les développeurs ;
 *  - production  : « client-apk » (APK bêta publique, AAB Play Store plus tard), ForgeChat,
 *                  prod, AUCUNE fonction de dev (vérifié par __tests__/production-profile.test.ts).
 */

type AppEnv = 'development' | 'lan' | 'preview' | 'production'
const APP_ENV = (process.env.APP_ENV ?? 'development') as AppEnv
if (!['development', 'lan', 'preview', 'production'].includes(APP_ENV)) {
  throw new Error(`APP_ENV inconnu : ${APP_ENV}`)
}
// LAN : l'URL (IP du PC de dev) vient de l'environnement de build, jamais du dépôt.
const API_URL =
  process.env.FORGECHAT_API_URL ?? (APP_ENV === 'lan' ? '' : 'https://forgechat.heiphaistos.org')
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID
// Identifiant FINAL de l'app publique (Play Store) : jamais configurable.
const BUNDLE_ID = 'org.heiphaistos.forgechat'
const PACKAGES: Record<AppEnv, string> = {
  development: `${BUNDLE_ID}.development`,
  lan: `${BUNDLE_ID}.lan`,
  preview: `${BUNDLE_ID}.dev`,
  production: BUNDLE_ID,
}

// URL à remplacer (ex. pré-prod dans eas.json) : le build échoue tant qu'elle n'est pas renseignée.
if (/REMPLACER|\.invalid(?:[:/]|$)/i.test(API_URL)) {
  throw new Error(`FORGECHAT_API_URL n'est pas renseignée (« ${API_URL} ») : voir docs/DEPLOY.md`)
}
// Le code des outils de dev est retiré du bundle d'après EXPO_PUBLIC_APP_ENV (inliné à la
// compilation) : il doit être cohérent avec APP_ENV, et explicite en production.
const PUBLIC_ENV = process.env.EXPO_PUBLIC_APP_ENV
if ((PUBLIC_ENV !== undefined && PUBLIC_ENV !== APP_ENV) || (APP_ENV === 'production' && PUBLIC_ENV !== 'production')) {
  throw new Error(`EXPO_PUBLIC_APP_ENV (${PUBLIC_ENV ?? 'absent'}) doit valoir APP_ENV (${APP_ENV})`)
}

// Garde-fou : en dehors du développement, l'API DOIT être en HTTPS — sauf en LAN, où le HTTP
// n'est permis que vers une IPv4 privée (sinon lanCleartextHost fait échouer le build).
// (Le client vérifie aussi au runtime, cf. src/config/env.ts.)
const LAN_CLEARTEXT_HOST = APP_ENV === 'lan' ? withLanCleartext.lanCleartextHost(API_URL) : null
if (APP_ENV !== 'development' && APP_ENV !== 'lan' && !API_URL.startsWith('https://')) {
  throw new Error(`FORGECHAT_API_URL doit être en https:// pour APP_ENV=${APP_ENV}`)
}

// Icônes (scripts/generate-icons.mjs, logo officiel du web) : variante orange « DEV » pour tout ce
// qui n'est pas la version publique, pour ne jamais confondre les apps sur un téléphone.
const ASSETS = APP_ENV === 'production' ? './assets' : './assets/dev'

const APP_NAMES: Record<AppEnv, string> = {
  development: 'ForgeChat (development)',
  lan: 'ForgeChat (LAN)',
  preview: 'ForgeChat Dev',
  production: 'ForgeChat',
}

const apiHost = new URL(API_URL).host

export default (ctx: ConfigContext): ExpoConfig => {
  // Partage d'écran (MediaProjection) : permissions et service au premier plan, tous profils.
  const expoConfig = withScreenShare(buildConfig(ctx))
  // LAN : network_security_config limitant le HTTP en clair à l'IP du serveur de dev.
  return APP_ENV === 'lan' ? withLanCleartext(expoConfig, { host: LAN_CLEARTEXT_HOST }) : expoConfig
}

const buildConfig = ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: APP_NAMES[APP_ENV],
  slug: 'forgechat',
  scheme: 'forgechat',
  version: '1.0.0',
  orientation: 'portrait',
  icon: `${ASSETS}/icon.png`,
  userInterfaceStyle: 'dark',
  backgroundColor: '#1e1f22',
  ios: {
    bundleIdentifier: PACKAGES[APP_ENV],
    supportsTablet: true,
    associatedDomains: [`applinks:${apiHost}`],
    infoPlist: {
      NSCameraUsageDescription: 'ForgeChat utilise la caméra pour les appels vidéo et pour envoyer des photos.',
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
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_PHONE_STATE',
    ],
    // App Links : uniquement vers un vrai domaine (pas vers l'IP du profil LAN).
    intentFilters: APP_ENV === 'lan' ? [] : [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          { scheme: 'https', host: apiHost, pathPrefix: '/invite/' },
          { scheme: 'https', host: apiHost, pathPrefix: '/friend-invite/' },
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
        cameraPermission: 'ForgeChat utilise la caméra pour les appels vidéo et pour envoyer des photos.',
        microphonePermission: 'ForgeChat utilise le micro pour les appels et les salons vocaux.',
      },
    ],
    [
      '@config-plugins/react-native-webrtc',
      {
        cameraPermission: 'ForgeChat utilise la caméra pour les appels vidéo et pour envoyer des photos.',
        microphonePermission: 'ForgeChat utilise le micro pour les appels et les salons vocaux.',
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          // Interdit tout trafic HTTP en clair au niveau OS (en plus du contrôle applicatif).
          usesCleartextTraffic: APP_ENV === 'development',
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
          // Règles R8 requises par react-native-webrtc.
          extraProguardRules: '-keep class org.webrtc.** { *; }',
        },
      },
    ],
    'expo-web-browser',
    'expo-font',
    ['expo-splash-screen', { backgroundColor: '#1e1f22', image: `${ASSETS}/splash-icon.png`, imageWidth: 160 }],
    'expo-image',
    'expo-video',
    // Lecture seule des pièces jointes audio : même texte micro que WebRTC (clés Info.plist partagées).
    // Pas de lecture en arrière-plan : évite le service de premier plan « mediaPlayback » et ses
    // permissions (FOREGROUND_SERVICE_MEDIA_PLAYBACK), à justifier auprès de Google Play.
    [
      'expo-audio',
      { microphonePermission: 'ForgeChat utilise le micro pour les appels et les salons vocaux.', enableBackgroundPlayback: false },
    ],
  ],
  experiments: { typedRoutes: true },
  extra: {
    apiUrl: API_URL,
    appEnv: APP_ENV,
    ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
  },
})
