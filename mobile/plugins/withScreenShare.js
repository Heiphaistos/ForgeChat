// @ts-check
const { AndroidConfig, withAndroidManifest } = require('@expo/config-plugins')

/**
 * Partage d'écran Android (MediaProjection), diffusé par LiveKit.
 *
 * Android 14 exige un service au premier plan de type mediaProjection pendant la capture : ses
 * permissions sont déclarées ici. Le service lui-même est activé par le module natif du plugin
 * Expo de LiveKit (@livekit/react-native-expo-plugin, enableScreenShareService), qui appelle
 * LiveKitReactNative.setup au démarrage de l'application.
 *
 * Google Play demandera une déclaration pour FOREGROUND_SERVICE_MEDIA_PROJECTION
 * (voir mobile/docs/RELEASE.md).
 */

const PERMISSIONS = ['android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION']

/** @type {import('@expo/config-plugins').ConfigPlugin} */
const withScreenShare = (config) =>
  withAndroidManifest(config, (cfg) => {
    AndroidConfig.Permissions.ensurePermissions(cfg.modResults, PERMISSIONS)
    return cfg
  })

module.exports = withScreenShare
module.exports.PERMISSIONS = PERMISSIONS
