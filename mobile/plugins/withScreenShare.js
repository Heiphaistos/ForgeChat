// @ts-check
const { AndroidConfig, withAndroidManifest, withMainApplication } = require('@expo/config-plugins')

/**
 * Partage d'écran Android (react-native-webrtc, getDisplayMedia / MediaProjection).
 *
 * D'après la doc de react-native-webrtc (Documentation/AndroidInstallation.md) :
 *  - permissions FOREGROUND_SERVICE et FOREGROUND_SERVICE_MEDIA_PROJECTION (Android 14 :
 *    MediaProjection exige un service au premier plan de ce type) ;
 *  - WebRTCModuleOptions.enableMediaProjectionService = true très tôt au démarrage : la
 *    bibliothèque lance alors son MediaProjectionService (déclaré dans son propre manifeste,
 *    foregroundServiceType="mediaProjection") pendant la capture, avec sa notification.
 *
 * Google Play demandera une déclaration pour FOREGROUND_SERVICE_MEDIA_PROJECTION
 * (voir mobile/docs/RELEASE.md).
 */

const PERMISSIONS = ['android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION']
const MARKER = 'WebRTCModuleOptions.getInstance().enableMediaProjectionService = true'

/** Insère l'activation juste après super.onCreate() (Kotlin). Idempotent. */
function enableMediaProjectionService(src) {
  if (src.includes(MARKER)) return src
  const anchor = /super\.onCreate\(\)\n/
  if (!anchor.test(src)) throw new Error('withScreenShare : super.onCreate() introuvable dans MainApplication')
  return src.replace(
    anchor,
    (m) =>
      `${m}    // Partage d'écran : service au premier plan mediaProjection (plugins/withScreenShare.js)\n` +
      `    com.oney.WebRTCModule.${MARKER}\n`,
  )
}

/** @type {import('@expo/config-plugins').ConfigPlugin} */
const withScreenShare = (config) => {
  config = withAndroidManifest(config, (cfg) => {
    AndroidConfig.Permissions.ensurePermissions(cfg.modResults, PERMISSIONS)
    return cfg
  })
  return withMainApplication(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') throw new Error('withScreenShare : MainApplication Kotlin attendu')
    cfg.modResults.contents = enableMediaProjectionService(cfg.modResults.contents)
    return cfg
  })
}

module.exports = withScreenShare
module.exports.enableMediaProjectionService = enableMediaProjectionService
module.exports.PERMISSIONS = PERMISSIONS
