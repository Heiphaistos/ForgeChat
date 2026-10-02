// @ts-check
const { withAppBuildGradle } = require('@expo/config-plugins')

/**
 * Signature des APK distribués (APK DEV et bêta) avec la clé de release, gardée HORS du dépôt.
 *
 * Le build.gradle généré signe la release avec la clé debug : ce plugin la remplace par une config
 * lue dans l'environnement du build local (rien de secret dans le dépôt ni dans android/) :
 *   FORGECHAT_KEYSTORE                chemin du keystore (PKCS12)
 *   FORGECHAT_KEYSTORE_PASSWORD_FILE  fichier contenant le mot de passe (store = clé)
 *   FORGECHAT_KEY_ALIAS               alias (défaut : forgechat-release)
 * Sans FORGECHAT_KEYSTORE, l'APK release sort NON signé (inutilisable) : jamais de clé debug.
 * Sur EAS, le service injecte sa propre configuration de signature (clé importée dans EAS).
 * Voir mobile/docs/MAINTAINER.md.
 */

const MARKER = 'FORGECHAT_KEYSTORE'

const SIGNING_BLOCK = `
        // ForgeChat : clé de release hors dépôt (plugins/withReleaseSigning.js).
        if (System.getenv('FORGECHAT_KEYSTORE')) {
            release {
                def fcPassword = new File(System.getenv('FORGECHAT_KEYSTORE_PASSWORD_FILE')).text.trim()
                storeFile file(System.getenv('FORGECHAT_KEYSTORE'))
                storeType 'pkcs12'
                storePassword fcPassword
                keyAlias System.getenv('FORGECHAT_KEY_ALIAS') ?: 'forgechat-release'
                keyPassword fcPassword
            }
        }`

/** Transforme app/build.gradle. Idempotent ; échoue si la structure attendue a changé. */
function applyReleaseSigning(src) {
  if (src.includes(MARKER)) return src
  const debugBlock = /(signingConfigs \{\n\s+debug \{[^}]*\})/
  if (!debugBlock.test(src)) throw new Error('withReleaseSigning : signingConfigs.debug introuvable')
  let out = src.replace(debugBlock, (m) => m + SIGNING_BLOCK)
  const releaseDebug = /(release \{\n(?:\s*\/\/[^\n]*\n)*\s*)signingConfig signingConfigs\.debug/
  if (!releaseDebug.test(out)) throw new Error('withReleaseSigning : signingConfig du build release introuvable')
  out = out.replace(
    releaseDebug,
    (_m, head) => `${head}signingConfig System.getenv('FORGECHAT_KEYSTORE') ? signingConfigs.release : null`,
  )
  return out
}

/** @type {import('@expo/config-plugins').ConfigPlugin} */
const withReleaseSigning = (config) =>
  withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = applyReleaseSigning(cfg.modResults.contents)
    return cfg
  })

module.exports = Object.assign(withReleaseSigning, { applyReleaseSigning })
