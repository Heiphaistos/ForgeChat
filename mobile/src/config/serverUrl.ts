/**
 * Validation d'une URL de serveur saisie dans l'APK DEV (écran « Serveur » des Infos dev).
 * Fonction pure, sans dépendance à l'environnement : testée par __tests__/server-url.test.ts.
 *
 * Règles :
 *  - https:// vers n'importe quel hôte (nom de domaine ou IPv4) ;
 *  - http:// UNIQUEMENT vers une IPv4 privée (10/8, 172.16/12, 192.168/16), 127.0.0.1 ou 10.0.2.2
 *    (hôte de l'émulateur, dans 10/8) ;
 *  - origine seule : pas d'identifiants, de chemin, de requête ni de fragment.
 */

export type ServerUrlCheck = { ok: true; origin: string } | { ok: false; reason: string }

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

function ipv4Octets(host: string): number[] | null {
  const m = IPV4.exec(host)
  if (!m) return null
  const parts = m.slice(1, 5) as string[]
  if (parts.some((p) => Number(p) > 255 || (p.length > 1 && p.startsWith('0')))) return null
  return parts.map(Number)
}

/** Hôte vers lequel le HTTP en clair est toléré (réseau local ou émulateur). */
export function isCleartextAllowedHost(host: string): boolean {
  const o = ipv4Octets(host)
  if (!o) return false
  const [a = -1, b = -1] = o
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || host === '127.0.0.1'
}

function validHost(host: string): boolean {
  if (ipv4Octets(host)) return true
  if (IPV4.test(host)) return false // ressemble à une IPv4 mais invalide (octet > 255, zéro initial)
  if (host.length > 253) return false
  const labels = host.split('.')
  return labels.every((l) => LABEL.test(l)) && !/^\d+$/.test(labels[labels.length - 1] ?? '')
}

export const CLEARTEXT_RULE =
  'Le HTTP n’est autorisé que vers une IPv4 privée (10.x, 172.16–31.x, 192.168.x), 127.0.0.1 ou 10.0.2.2. Sinon, utilise https://.'

export function checkServerUrl(input: string): ServerUrlCheck {
  const value = input.trim().replace(/\/+$/, '')
  if (!value) return { ok: false, reason: 'Saisis une adresse.' }
  const m = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(value)
  if (!m) return { ok: false, reason: 'Adresse invalide : elle doit commencer par https:// (ou http:// en réseau local).' }
  const scheme = (m[1] ?? '').toLowerCase()
  if (scheme !== 'https' && scheme !== 'http') return { ok: false, reason: 'Seuls https:// et http:// sont acceptés.' }
  const rest = m[2] ?? ''
  if (/[/?#@\\\s]/.test(rest)) {
    return { ok: false, reason: 'Indique seulement l’adresse du serveur (sans identifiants, chemin ni paramètres).' }
  }
  const hp = /^([^:]+)(?::(\d{1,5}))?$/.exec(rest)
  if (!hp) return { ok: false, reason: 'Adresse invalide.' }
  const host = (hp[1] ?? '').toLowerCase()
  const port = hp[2] === undefined ? null : Number(hp[2])
  if (!validHost(host)) return { ok: false, reason: 'Nom d’hôte invalide.' }
  if (port !== null && (port < 1 || port > 65535)) return { ok: false, reason: 'Port invalide (1 à 65535).' }
  if (scheme === 'http' && !isCleartextAllowedHost(host)) return { ok: false, reason: CLEARTEXT_RULE }
  return { ok: true, origin: `${scheme}://${host}${port === null ? '' : `:${port}`}` }
}

/** Préréglage « Serveur local » : IP du PC (IPv4 privée) et port du serveur, en HTTP. */
export function localServerUrl(ip: string, port: string | number = 8080): ServerUrlCheck {
  const host = ip.trim()
  if (!isCleartextAllowedHost(host)) {
    return { ok: false, reason: 'Saisis l’IPv4 locale du PC (ex. 192.168.x.y), 127.0.0.1 ou 10.0.2.2 pour l’émulateur.' }
  }
  return checkServerUrl(`http://${host}:${String(port).trim()}`)
}
