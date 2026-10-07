// @ts-check
const { AndroidConfig, withAndroidManifest } = require('@expo/config-plugins')

/**
 * Image dans l'image Android pendant un appel vidéo (modules/call-service, CallWindow.kt) :
 * l'activité principale doit l'autoriser, et gérer elle-même les changements de taille (sinon
 * Android la recréerait en entrant en PiP, ce qui couperait l'interface de l'appel).
 */
const CONFIG_CHANGES = ['orientation', 'screenLayout', 'screenSize', 'smallestScreenSize']

/** @param {import('@expo/config-plugins').AndroidConfig.Manifest.AndroidManifest} manifest */
function applyPictureInPicture(manifest) {
  const activity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest)
  activity.$['android:supportsPictureInPicture'] = 'true'
  const current = (activity.$['android:configChanges'] ?? '').split('|').filter(Boolean)
  activity.$['android:configChanges'] = [...new Set([...current, ...CONFIG_CHANGES])].join('|')
  return manifest
}

/** @type {import('@expo/config-plugins').ConfigPlugin} */
const withPictureInPicture = (config) =>
  withAndroidManifest(config, (cfg) => {
    cfg.modResults = applyPictureInPicture(cfg.modResults)
    return cfg
  })

module.exports = withPictureInPicture
module.exports.applyPictureInPicture = applyPictureInPicture
