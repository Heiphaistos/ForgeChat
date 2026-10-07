// Lot « Messages et discussion » : règles pures (testées dans __tests__/messaging.test.ts).
import { isUuid } from '@/lib/params'
import type { Key } from '@/i18n'

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

// ─── Messages éphémères ──────────────────────────────────────────────────────
/** null = désactivé, 0 = après lecture (MP et groupes), sinon secondes (1 h, 24 h, 7 j). */
export const DISAPPEAR_CHOICES: { value: number | null; label: Key; short?: Key }[] = [
  { value: null, label: 'messaging.disappear.off' },
  { value: 3600, label: 'messaging.disappear.1h', short: 'messaging.disappear.short1h' },
  { value: 86_400, label: 'messaging.disappear.24h', short: 'messaging.disappear.short24h' },
  { value: 604_800, label: 'messaging.disappear.7d', short: 'messaging.disappear.short7d' },
  { value: 0, label: 'messaging.disappear.afterRead', short: 'messaging.disappear.shortRead' },
]

/** Choix proposés : un salon n'a pas « après lecture ». */
export const disappearChoices = (kind: 'dm' | 'group' | 'channel') =>
  DISAPPEAR_CHOICES.filter((c) => kind !== 'channel' || c.value !== 0)

export const disappearChoice = (v: number | null | undefined) =>
  DISAPPEAR_CHOICES.find((c) => c.value === (v ?? null)) ?? DISAPPEAR_CHOICES[0]!

/** Réglage reçu du serveur (GET /disappearing, DISAPPEARING_UPDATE, salon) : valeur connue ou null. */
export function parseDisappear(v: unknown): number | null {
  return typeof v === 'number' && DISAPPEAR_CHOICES.some((c) => c.value === v) ? v : null
}

// ─── Messages programmés (« À envoyer ») ─────────────────────────────────────
export interface ScheduledEntry {
  id: string
  channelId: string
  serverId: string
  channelName: string
  serverName: string
  sendAt: string
  /** Texte déchiffré (ou texte d'attente si la clé manque). */
  content: string
  locked: boolean
  clientMsgId: string | null
}

/** GET /scheduled déjà passé par openRawList : entrées valides seulement, triées par date d'envoi. */
export function normalizeScheduledAll(raw: unknown): ScheduledEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map(obj)
    .flatMap((r) => {
      const [id, channelId, serverId, sendAt] = [str(r.id), str(r.channel_id), str(r.server_id), str(r.send_at)]
      if (!isUuid(id) || !isUuid(channelId) || !isUuid(serverId) || !sendAt) return []
      return [{
        id: id.toLowerCase(), channelId: channelId.toLowerCase(), serverId: serverId.toLowerCase(),
        channelName: str(r.channel_name) ?? '', serverName: str(r.server_name) ?? '', sendAt,
        content: str(r.content) ?? '', locked: r.e2e === 'locked', clientMsgId: str(r.client_msg_id),
      }]
    })
    .sort((a, b) => a.sendAt.localeCompare(b.sendAt))
}

// ─── Sondages : votants (sondage non anonyme) ────────────────────────────────
/** GET …/voters : { option_id: [{ id, username }] } → noms par option. */
export function normalizeVoters(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [opt, list] of Object.entries(obj(raw))) {
    if (!isUuid(opt) || !Array.isArray(list)) continue
    out[opt.toLowerCase()] = list.map(obj).flatMap((u) => (str(u.username) ? [str(u.username)!] : []))
  }
  return out
}

// ─── Fils automatiques ───────────────────────────────────────────────────────
/** Titre d'un fil ouvert automatiquement : début du message, sur une ligne. */
export function autoThreadTitle(text: string | null | undefined, fallback: string): string {
  const t = [...(text ?? '').replace(/\s+/g, ' ').trim()].slice(0, 80).join('')
  return t || fallback
}
