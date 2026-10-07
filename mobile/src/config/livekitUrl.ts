import { t } from '@/i18n'
import { isCleartextAllowedHost } from './serverUrl'

/**
 * Adresse du serveur média LiveKit, reçue du serveur ForgeChat avec chaque jeton d'accès
 * (VOICE_EXISTING_PEERS, DM_CALL_ACCEPTED, DM_CALL_MEDIA). Fonction pure, testée par
 * __tests__/livekit-url.test.ts.
 *
 *  - bêta (production) : wss:// uniquement, et l'hôte doit être celui du serveur ForgeChat ou celui
 *    fixé au build (FORGECHAT_LIVEKIT_URL) : un serveur compromis ou une réponse falsifiée ne peut
 *    pas envoyer la voix et la caméra ailleurs ;
 *  - autres profils (development, lan, APK DEV) : wss:// vers tout hôte, ws:// seulement vers une
 *    IPv4 privée, 127.0.0.1 ou 10.0.2.2 (même règle que l'écran « Serveur »).
 */

export interface LiveKitUrlPolicy {
  appEnv: string
  /** Hôte (nom, sans port) du serveur ForgeChat utilisé. */
  apiHost: string
  /** Hôte LiveKit fixé au build (bêta), s'il diffère de celui du serveur. */
  pinnedHost?: string | null
}

export type LiveKitUrlCheck = { ok: true; url: string; host: string } | { ok: false; reason: string }

const URL_RE = /^(wss?):\/\/([a-z0-9.-]+)(?::(\d{1,5}))?(\/[a-z0-9._~\-/]*)?$/i
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/

export function checkLiveKitUrl(raw: unknown, policy: LiveKitUrlPolicy): LiveKitUrlCheck {
  if (typeof raw !== 'string' || raw.length > 512) return { ok: false, reason: t('store.livekit.missing') }
  const m = URL_RE.exec(raw.trim())
  if (!m) return { ok: false, reason: t('store.livekit.invalid') }
  const scheme = (m[1] ?? '').toLowerCase()
  const host = (m[2] ?? '').toLowerCase()
  const port = m[3] === undefined ? null : Number(m[3])
  if (!host || host.startsWith('.') || host.endsWith('.') || host.includes('..')) {
    return { ok: false, reason: t('store.livekit.invalid') }
  }
  if (port !== null && (port < 1 || port > 65535)) return { ok: false, reason: t('store.livekit.invalid') }

  if (policy.appEnv === 'production') {
    if (scheme !== 'wss') return { ok: false, reason: t('store.livekit.cleartext') }
    const expected = (policy.pinnedHost || policy.apiHost).toLowerCase()
    if (IPV4_RE.test(host) || host !== expected) {
      return { ok: false, reason: t('store.livekit.unexpected') }
    }
  } else if (scheme === 'ws' && !isCleartextAllowedHost(host)) {
    return { ok: false, reason: t('store.livekit.lanOnly') }
  }
  return { ok: true, url: `${scheme}://${host}${port === null ? '' : `:${port}`}${m[4] ?? ''}`, host }
}

/** Accès au SFU joint par le serveur : { url, token, room?, e2ee?, conv_id? }. */
export interface LiveKitAccess {
  url: string
  token: string
  room: string | null
  /** La salle exige des médias chiffrés de bout en bout (docs/CHIFFREMENT-E2E.md §5). */
  e2ee: boolean
  /** Conversation dont la clé chiffre les médias, quand le serveur la précise (appel privé). */
  convId: string | null
}

/** Valide l'objet `livekit` d'un événement du serveur ; null (+ raison) s'il est inutilisable. */
export function parseLiveKitAccess(v: unknown, policy: LiveKitUrlPolicy): { access: LiveKitAccess } | { error: string } {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>
  if (typeof o.token !== 'string' || o.token.length < 10 || o.token.length > 8192) {
    return { error: t('store.livekit.unavailable') }
  }
  const url = checkLiveKitUrl(o.url, policy)
  if (!url.ok) return { error: url.reason }
  const room = typeof o.room === 'string' && o.room.length > 0 && o.room.length < 200 ? o.room : null
  const convId = typeof o.conv_id === 'string' && o.conv_id.length < 64 ? o.conv_id : null
  return { access: { url: url.url, token: o.token, room, e2ee: o.e2ee === true, convId } }
}
