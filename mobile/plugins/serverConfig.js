// @ts-check
/**
 * Adresse du serveur fixée AU BUILD (aucune adresse par défaut cachée dans l'app).
 * Utilisé par app.config.ts et scripts/build-apk-local.sh ; testé par __tests__/production-profile.test.ts.
 *
 *   FORGECHAT_API_URL      serveur ForgeChat (https://…)
 *   FORGECHAT_LIVEKIT_URL  serveur média LiveKit, seulement s'il n'est pas sur le même hôte (wss://…)
 *
 * Bêta (production) : FORGECHAT_API_URL obligatoire, https:// uniquement, jamais d'IP locale, de
 * localhost ni de domaine réservé (.local, .test, .invalid…). APK DEV (preview) : facultatif (préréglage
 * « Pré-prod » ; le serveur se choisit dans l'app), https:// s'il est donné. development / lan : voir
 * app.config.ts (réseau local).
 */

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/
const RESERVED_TLD = /\.(local|localhost|test|invalid|example|internal|lan|home|corp)$/i

/** Hôte refusé pour une app distribuée : IP (locale ou non), localhost, domaine réservé. */
function isForbiddenPublicHost(host) {
  const h = host.toLowerCase()
  return IPV4.test(h) || h.includes(':') || h === 'localhost' || !h.includes('.') || RESERVED_TLD.test(h)
}

/**
 * @param {string} raw
 * @param {'https' | 'wss'} scheme
 * @param {string} name nom de la variable (messages d'erreur)
 * @returns {{ origin: string, host: string }}
 */
function parsePublicUrl(raw, scheme, name) {
  const value = String(raw).trim()
  const m = /^([a-z]+):\/\/([a-z0-9.-]+)(?::(\d{1,5}))?(\/[a-z0-9._~\-/]*)?$/i.exec(value)
  if (!m) throw new Error(`${name} invalide (« ${value} ») : attendu ${scheme}://nom.de.domaine`)
  const [, s = '', host = '', port, path = ''] = m
  if (s.toLowerCase() !== scheme) throw new Error(`${name} doit commencer par ${scheme}:// (« ${value} »)`)
  if (isForbiddenPublicHost(host)) {
    throw new Error(`${name} : « ${host} » refusé (IP, localhost ou domaine réservé) — il faut le vrai nom de domaine public`)
  }
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) throw new Error(`${name} : port invalide`)
  if (scheme === 'https' && path.replace(/\/+$/, '') !== '') throw new Error(`${name} : indique seulement l'origine (sans chemin)`)
  const p = scheme === 'wss' ? path.replace(/\/+$/, '') : ''
  return { origin: `${scheme}://${host.toLowerCase()}${port ? `:${port}` : ''}${p}`, host: host.toLowerCase() }
}

/**
 * Configuration serveur d'un build distribué.
 * @param {string} appEnv
 * @param {string | undefined} apiUrl FORGECHAT_API_URL
 * @param {string | undefined} livekitUrl FORGECHAT_LIVEKIT_URL
 * @returns {{ apiUrl: string, livekitHost: string | null }}
 */
function distributedServerConfig(appEnv, apiUrl, livekitUrl) {
  const api = (apiUrl ?? '').trim()
  const lk = (livekitUrl ?? '').trim()
  if (appEnv === 'production' && !api) {
    throw new Error(
      'FORGECHAT_API_URL manquant : la bêta n’a AUCUNE adresse par défaut. ' +
        'Build local : scripts/build-apk-local.sh production --server https://ton.domaine ; ' +
        'EAS : variable FORGECHAT_API_URL (environnement production). Voir docs/MAINTAINER.md.',
    )
  }
  const parsed = api ? parsePublicUrl(api, 'https', 'FORGECHAT_API_URL') : null
  const livekit = lk ? parsePublicUrl(lk, 'wss', 'FORGECHAT_LIVEKIT_URL') : null
  return { apiUrl: parsed ? parsed.origin : '', livekitHost: livekit ? livekit.host : null }
}

module.exports = { distributedServerConfig, isForbiddenPublicHost }
