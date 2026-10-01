// @ts-check
/**
 * Crochet EAS « eas-build-pre-install » (package.json), exécuté sur le serveur de build avant
 * l'installation des dépendances.
 *
 * Production (client-apk / AAB) : expo-dev-client et ses modules sont EXCLUS de l'autolinking,
 * pour qu'aucun outil de développement ne soit compilé dans l'app publique (en release, ils ne
 * seraient que désactivés). Sans effet pour les autres profils.
 */
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const DEV_CLIENT_MODULES = ['expo-dev-client', 'expo-dev-launcher', 'expo-dev-menu', 'expo-dev-menu-interface']

/** package.json avec les modules du client de dev exclus de l'autolinking (idempotent). */
function excludeDevClient(pkg) {
  const expo = { ...(pkg.expo ?? {}) }
  const autolinking = { ...(expo.autolinking ?? {}) }
  autolinking.exclude = [...new Set([...(autolinking.exclude ?? []), ...DEV_CLIENT_MODULES])]
  return { ...pkg, expo: { ...expo, autolinking } }
}

if (require.main === module) {
  if (process.env.APP_ENV !== 'production') {
    console.log(`eas-build-pre-install : APP_ENV=${process.env.APP_ENV ?? '?'}, rien à faire.`)
  } else {
    const file = join(__dirname, '..', 'package.json')
    const pkg = JSON.parse(readFileSync(file, 'utf8'))
    writeFileSync(file, `${JSON.stringify(excludeDevClient(pkg), null, 2)}\n`)
    console.log(`eas-build-pre-install : exclus de l'autolinking (production) : ${DEV_CLIENT_MODULES.join(', ')}`)
  }
}

module.exports = { excludeDevClient, DEV_CLIENT_MODULES }
