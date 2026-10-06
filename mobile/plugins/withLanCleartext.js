// @ts-check
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('@expo/config-plugins')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

/**
 * Profil LAN (APP_ENV=lan) : APK de test sur un téléphone du réseau local, jamais distribué.
 *
 * Le trafic HTTP en clair reste interdit globalement (usesCleartextTraffic=false) ; seul l'hôte de
 * FORGECHAT_API_URL est autorisé, par un network_security_config, et seulement si c'est une IPv4
 * privée (10/8, 172.16/12, 192.168/16). Toute autre URL fait échouer le build.
 * (JavaScript CommonJS : chargé tel quel par app.config.ts ; types dans withLanCleartext.d.ts.)
 */

/** Vrai si `host` est une IPv4 littérale d'une plage privée RFC 1918. */
function isPrivateIpv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const o = m.slice(1).map((x) => (/^0\d/.test(x) ? NaN : Number(x)))
  if (o.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return false
  const [a, b] = o
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

/**
 * Hôte à autoriser en clair pour le profil LAN, ou erreur si l'URL ne convient pas :
 * http(s)://<IPv4 privée>[:port], sans chemin, identifiants, requête ni fragment.
 * Renvoie null en https (aucune exception de clair nécessaire).
 */
function lanCleartextHost(apiUrl) {
  if (!apiUrl) throw new Error('APP_ENV=lan : FORGECHAT_API_URL est obligatoire (ex. http://192.168.1.20:8080)')
  let u
  try {
    u = new URL(apiUrl)
  } catch {
    throw new Error(`APP_ENV=lan : FORGECHAT_API_URL invalide : "${apiUrl}"`)
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('APP_ENV=lan : FORGECHAT_API_URL doit être en http:// ou https://')
  }
  if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) {
    throw new Error('APP_ENV=lan : FORGECHAT_API_URL doit être une origine seule (ex. http://192.168.1.20:8080)')
  }
  if (!isPrivateIpv4(u.hostname)) {
    throw new Error(`APP_ENV=lan : l'hôte "${u.hostname}" n'est pas une IPv4 privée (10.x, 172.16-31.x, 192.168.x)`)
  }
  return u.protocol === 'http:' ? u.hostname : null
}

/** Contenu de res/xml/network_security_config.xml : clair interdit partout sauf pour `host`. */
function networkSecurityConfigXml(host) {
  const domain = host
    ? `
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">${host}</domain>
  </domain-config>`
    : ''
  return `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />${domain}
</network-security-config>
`
}

/** @type {import('@expo/config-plugins').ConfigPlugin<{ host: string | null }>} */
const withLanCleartext = (config, { host }) => {
  config = withDangerousMod(config, [
    'android',
    (cfg) => {
      const dir = join(cfg.modRequest.platformProjectRoot, 'app/src/main/res/xml')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'network_security_config.xml'), networkSecurityConfigXml(host))
      return cfg
    },
  ])
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults)
    app.$['android:networkSecurityConfig'] = '@xml/network_security_config'
    return cfg
  })
}

module.exports = withLanCleartext
module.exports.isPrivateIpv4 = isPrivateIpv4
module.exports.lanCleartextHost = lanCleartextHost
module.exports.networkSecurityConfigXml = networkSecurityConfigXml
