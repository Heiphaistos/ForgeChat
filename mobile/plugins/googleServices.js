// @ts-check
const { existsSync } = require('node:fs')

/**
 * Push Android (FCM) : chemin du google-services.json de Firebase, gardé HORS du dépôt.
 * Passé par l'environnement : EAS (variable de type « fichier » GOOGLE_SERVICES_JSON) ou build local
 * (chemin absolu). Absent : build sans FCM, donc sans notifications push. Ignoré en LAN (push coupé).
 * @param {string} appEnv
 * @param {string | undefined} value
 * @returns {string | undefined}
 */
function googleServicesFile(appEnv, value) {
  if (appEnv === 'lan' || !value) return undefined
  if (!existsSync(value)) throw new Error(`GOOGLE_SERVICES_JSON pointe vers un fichier introuvable : ${value}`)
  return value
}

module.exports = { googleServicesFile }
