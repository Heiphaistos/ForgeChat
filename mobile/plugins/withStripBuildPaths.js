// @ts-check
const { withAppBuildGradle } = require('@expo/config-plugins')

/**
 * APK distribués : retire le chemin du dossier personnel de la machine de build des bibliothèques
 * natives compilées par le CMake de l'app (libappmodules, codegen), où __FILE__ l'inscrivait.
 * Le chemin est calculé par gradle au moment du build (user.home) : rien n'est écrit dans le dépôt.
 * (Les bibliothèques tierces compilées localement le reçoivent par CFLAGS/CXXFLAGS : voir
 * scripts/build-apk-local.sh.)
 */

const MARKER = 'ffile-prefix-map'

const BLOCK = `
        // Chemins de compilation retirés des .so (plugins/withStripBuildPaths.js).
        externalNativeBuild {
            cmake {
                def fcPrefixMap = "-ffile-prefix-map=\${System.getProperty('user.home')}=/build"
                cFlags fcPrefixMap
                cppFlags fcPrefixMap
            }
        }`

/** Transforme app/build.gradle. Idempotent. */
function applyStripBuildPaths(src) {
  if (src.includes(MARKER)) return src
  const anchor = /(\n\s+defaultConfig \{\n)/
  if (!anchor.test(src)) throw new Error('withStripBuildPaths : defaultConfig introuvable')
  return src.replace(anchor, (m) => `${m.trimEnd()}${BLOCK}\n`)
}

/** @type {import('@expo/config-plugins').ConfigPlugin} */
const withStripBuildPaths = (config) =>
  withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = applyStripBuildPaths(cfg.modResults.contents)
    return cfg
  })

module.exports = Object.assign(withStripBuildPaths, { applyStripBuildPaths })
