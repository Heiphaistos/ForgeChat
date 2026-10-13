// Support à distance natif (GhostHandDesk) : fonctions pures, partagées à l'identique avec
// mobile/src/lib/remoteSupport.ts. Le message `rs` voyage DANS le contenu chiffré de bout en
// bout d'un MP (champ `rs` du corps scellé) : le serveur ForgeChat ne voit jamais l'identifiant
// ni le code. Testé par scripts/remoteSupport.test.mjs.

/** Offre d'aide (« Aider » : je prendrai la main), invitation (« Demander de l'aide » : identifiant
 *  + code de l'ordinateur à aider), réponse à une offre ou une invitation. */
export type SupportKind = 'offer' | 'invite' | 'accept' | 'decline'

export interface SupportPayload {
  v: 1
  k: SupportKind
  /** invite : identifiant GhostHandDesk (9 chiffres) de l'ordinateur à aider. */
  id?: string
  /** invite : code de support à usage unique (12 caractères base32 Crockford, 60 bits). */
  code?: string
  /** invite : fin de validité du code (ms depuis 1970). */
  exp?: number
  /** accept/decline/invite en réponse : `client_msg_id` du message visé. */
  ref?: string
}

export const GHD_SITE = 'https://ghd.heiphaistos.org'
export const GHD_WEB_VIEWER = `${GHD_SITE}/app/`
/** Agent GhostHandDesk (Windows seulement) : portable, sans installation. Il se met à jour
 *  tout seul ; à suivre quand une version change le protocole des liens. */
export const GHD_WINDOWS_DOWNLOAD = `${GHD_SITE}/download/v0.9.0/GhostHandDesk_0.9.0_portable_x64.exe`
/** Durée de validité d'un code (secondes), comme le défaut de GhostHandDesk. */
export const CODE_TTL = 600
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{12}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Code à usage unique tiré par le générateur cryptographique (32 symboles = 5 bits exacts, sans biais). */
export function newCode(random: (n: number) => Uint8Array = n => crypto.getRandomValues(new Uint8Array(n))): string {
  return Array.from(random(12), b => ALPHABET[b & 31]).join('')
}

/** Partager son écran exige l'agent GhostHandDesk, qui n'existe que sous Windows. */
export const canHostGhd = (userAgent: string) => /\bWindows NT\b/.test(userAgent)

export const formatCode = (code: string) => code.match(/.{1,4}/g)?.join('-') ?? code
export const cleanId = (id: string) => id.replace(/[\s-]/g, '')
export const isDeviceId = (id: string) => /^[1-9]\d{8}$/.test(cleanId(id))
export const formatId = (id: string) => cleanId(id).replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3')

/** Contenu `rs` déchiffré validé ; null s'il est absent ou mal formé (jamais d'affichage partiel). */
export function parseSupport(raw: unknown): SupportPayload | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.v !== 1 || !['offer', 'invite', 'accept', 'decline'].includes(r.k as string)) return null
  const out: SupportPayload = { v: 1, k: r.k as SupportKind }
  if (r.ref !== undefined) {
    if (typeof r.ref !== 'string' || !UUID_RE.test(r.ref)) return null
    out.ref = r.ref
  }
  if (out.k === 'invite') {
    if (typeof r.id !== 'string' || !isDeviceId(r.id)) return null
    if (typeof r.code !== 'string' || !CODE_RE.test(r.code)) return null
    if (typeof r.exp !== 'number' || !Number.isFinite(r.exp)) return null
    Object.assign(out, { id: cleanId(r.id), code: r.code, exp: r.exp })
  }
  if ((out.k === 'accept' || out.k === 'decline') && !out.ref) return null
  return out
}

export function invite(id: string, code: string, now = Date.now(), ref?: string): SupportPayload {
  return { v: 1, k: 'invite', id: cleanId(id), code, exp: now + CODE_TTL * 1000, ...(ref ? { ref } : {}) }
}

export const expired = (p: SupportPayload, now = Date.now()) => p.k === 'invite' && (p.exp ?? 0) <= now

/** Hôte : arme le code dans GhostHandDesk (l'utilisateur confirmera quand même la prise en main). */
export const shareLink = (code: string, ttl = CODE_TTL) => `ghosthanddesk://share?code=${code}&ttl=${ttl}`
/** Aidant avec l'application : connexion directe avec le code. */
export const connectLink = (id: string, code: string) => `ghosthanddesk://connect?id=${cleanId(id)}&code=${code}`
/** Arguments de la commande de bureau `ghd_launch` tirés d'un lien share/connect (null = lien refusé). */
export function ghdLaunchArgs(url: string): { action: string; code: string; id: string | null; ttl: number | null } | null {
  if (!/^ghosthanddesk:\/\/(share|connect)\?/.test(url)) return null
  const u = new URL(url)
  const ttl = Number(u.searchParams.get('ttl'))
  return { action: u.host, code: u.searchParams.get('code') ?? '', id: u.searchParams.get('id'), ttl: ttl > 0 ? ttl : null }
}
/** Aidant sans l'application : visionneuse web. Fragment = jamais envoyé au serveur web ni journalisé. */
export const webViewerLink = (id: string, code: string) => `${GHD_WEB_VIEWER}#id=${cleanId(id)}&code=${code}`

