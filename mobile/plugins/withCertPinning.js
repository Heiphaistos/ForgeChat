// @ts-check
const { AndroidConfig, withAndroidManifest, withDangerousMod, withInfoPlist } = require('@expo/config-plugins')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

/**
 * Épinglage des autorités de certification du serveur (audit 2026-10-12, amélioration n° 20).
 *
 * On épingle des autorités RACINES (clé publique, SPKI SHA-256), pas le certificat du site : Let's
 * Encrypt le renouvelle tous les 90 jours. Une autorité compromise ou contrainte parmi les ~150 du
 * système ne peut plus émettre un faux certificat accepté par l'appli. Secours inclus pour pouvoir
 * changer de fournisseur ACME sans bloquer les applis déjà installées :
 *   ISRG Root X1 / X2 (Let's Encrypt, utilisé aujourd'hui), GTS Root R1 / R4 (Google Trust
 *   Services), USERTrust RSA / ECC (Sectigo, ZeroSSL).
 * Calcul : openssl x509 -in CA.pem -pubkey -noout | openssl pkey -pubin -outform der
 *          | openssl dgst -sha256 -binary | base64
 * Android : `pin-set` avec expiration (au-delà, retour à la confiance du système plutôt qu'un
 * blocage si l'appli n'a pas été mise à jour). iOS : NSPinnedDomains (ATS).
 * Seulement pour l'hôte HTTPS de l'API (jamais une IP, jamais le profil LAN).
 */
const PINS = [
  'C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M=', // ISRG Root X1 (2035)
  'diGVwiVYbubAI3RW4hB9xU8e/CH2GnkuvVFZE8zmgzI=', // ISRG Root X2 (2040)
  'hxqRlPTu1bMS/0DITB1SSu0vd4u/8l8TjPgfaAp63Gc=', // GTS Root R1 (2036)
  'mEflZT5enoR1FuXLgYYGqnVEoZvmf9c2bVBpiOjYQ0c=', // GTS Root R4 (2036)
  'x4QzPSC810K5/cMjb05Qm4k3Bw5zBn4lTdO/nEW/Td4=', // USERTrust RSA (2038)
  'ICGRfpgmOUXIWcQ/HXPLQTkFPEFPoDyjvH7ohhQpjzs=', // USERTrust ECC (2038)
]
const ANDROID_EXPIRATION = '2030-01-01'

/** Hôte à épingler : nom DNS d'une URL https, sinon null. */
function pinnedHost(apiUrl) {
  let u
  try {
    u = new URL(apiUrl ?? '')
  } catch {
    return null
  }
  if (u.protocol !== 'https:') return null
  if (/^[\d.]+$/.test(u.hostname) || u.hostname.includes(':') || !u.hostname.includes('.')) return null
  return u.hostname
}

/** Hôtes à épingler : l'API, plus le SFU LiveKit s'il est sur un autre hôte DNS (`host[:port]`). */
function pinnedHosts(apiUrl, livekitHost) {
  const api = pinnedHost(apiUrl)
  const lk = livekitHost ? pinnedHost(`https://${livekitHost}`) : null
  return api ? [...new Set([api, ...(lk ? [lk] : [])])] : []
}

function networkSecurityConfigXml(hosts) {
  const domains = [].concat(hosts).map((h) => `    <domain includeSubdomains="false">${h}</domain>`).join('\n')
  const pins = PINS.map((p) => `      <pin digest="SHA-256">${p}</pin>`).join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="false">
${domains}
    <pin-set expiration="${ANDROID_EXPIRATION}">
${pins}
    </pin-set>
  </domain-config>
</network-security-config>
`
}

function pinnedDomainsPlist(hosts) {
  return Object.fromEntries(
    [].concat(hosts).map((h) => [h, { NSIncludesSubdomains: false, NSPinnedCAIdentities: PINS.map((p) => ({ 'SPKI-SHA256-BASE64': p })) }]),
  )
}

/** @type {import('@expo/config-plugins').ConfigPlugin<{ apiUrl: string | undefined; livekitHost?: string | null }>} */
const withCertPinning = (config, { apiUrl, livekitHost }) => {
  const host = pinnedHosts(apiUrl, livekitHost)
  if (!host.length) return config
  config = withDangerousMod(config, [
    'android',
    (cfg) => {
      const dir = join(cfg.modRequest.platformProjectRoot, 'app/src/main/res/xml')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'network_security_config.xml'), networkSecurityConfigXml(host))
      return cfg
    },
  ])
  config = withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults)
    app.$['android:networkSecurityConfig'] = '@xml/network_security_config'
    return cfg
  })
  return withInfoPlist(config, (cfg) => {
    const ats = /** @type {Record<string, unknown>} */ (cfg.modResults.NSAppTransportSecurity ?? {})
    cfg.modResults.NSAppTransportSecurity = { ...ats, NSPinnedDomains: pinnedDomainsPlist(host) }
    return cfg
  })
}

module.exports = withCertPinning
module.exports.PINS = PINS
module.exports.pinnedHost = pinnedHost
module.exports.pinnedHosts = pinnedHosts
module.exports.networkSecurityConfigXml = networkSecurityConfigXml
module.exports.pinnedDomainsPlist = pinnedDomainsPlist
