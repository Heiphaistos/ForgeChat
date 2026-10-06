import { isUuid } from '@/lib/params'
import type { Attachment, ChatMessage, ConversationRef } from '@/types/models'

/**
 * Transférer, enregistrer, rappel, historique des modifications : le serveur ne résout le message
 * que dans `messages` (salons) ou `dm_messages` (DM 1:1) — handlers/messages.rs::forward_message,
 * set_reminder, get_message_edits et handlers/saved.rs. Les groupes privés n'y sont pas pris en charge.
 */
export function supportsMessageExtras(ref: ConversationRef): boolean {
  return ref.kind === 'channel' || ref.kind === 'dm'
}

/**
 * Corps de POST /saved (saved.rs::SaveMessageBody). En DM, `channel_id` est l'id du DM et
 * `server_id` vaut null (le serveur vérifie alors l'appartenance au DM). Le contenu et l'auteur
 * sont figés côté serveur : ils restent lisibles si le message d'origine est supprimé.
 */
export function savedBody(ref: ConversationRef, m: ChatMessage) {
  if (ref.kind === 'group') throw new Error('Messages de groupe non enregistrables')
  return {
    message_id: m.id,
    channel_id: ref.kind === 'channel' ? ref.channelId : ref.dmId,
    server_id: ref.kind === 'channel' ? ref.serverId : null,
    content: m.content,
    author_username: m.authorName,
    author_avatar: m.authorAvatar,
  }
}

/** Un message enregistré (saved.rs::SavedMessage). */
export interface SavedItem {
  messageId: string
  channelId: string
  serverId: string | null
  content: string | null
  authorName: string
  authorAvatar: string | null
  createdAt: string
  channelName: string | null
  serverName: string | null
  attachments: Attachment[]
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

export function normalizeSaved(raw: unknown): SavedItem[] {
  if (!Array.isArray(raw)) return []
  const out: SavedItem[] = []
  for (const r of raw.map(obj)) {
    const messageId = str(r.message_id)
    const channelId = str(r.channel_id)
    const serverId = str(r.server_id)
    if (!isUuid(messageId) || !isUuid(channelId) || (serverId !== null && !isUuid(serverId))) continue
    out.push({
      messageId: messageId.toLowerCase(),
      channelId: channelId.toLowerCase(),
      serverId: serverId?.toLowerCase() ?? null,
      content: str(r.content),
      authorName: str(r.author_username) ?? 'Inconnu',
      authorAvatar: str(r.author_avatar),
      createdAt: str(r.created_at) ?? str(r.saved_at) ?? '',
      channelName: str(r.channel_name),
      serverName: str(r.server_name),
      attachments: Array.isArray(r.attachments) ? (r.attachments.filter((a) => a && typeof a === 'object') as Attachment[]) : [],
    })
  }
  return out
}

/** Conversation d'origine d'un message enregistré (comme SavedPage : salon si server_id, sinon DM). */
export function savedConversation(s: SavedItem): ConversationRef {
  return s.serverId ? { kind: 'channel', serverId: s.serverId, channelId: s.channelId } : { kind: 'dm', dmId: s.channelId }
}

// ─── Rappels ──────────────────────────────────────────────────────────────────

export interface ReminderPreset {
  label: string
  date: Date
}

/** Choix rapides : 20 min, 1 h, 3 h, demain 9 h (heure locale). */
export function reminderPresets(now: Date): ReminderPreset[] {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0)
  return [
    { label: 'Dans 20 minutes', date: new Date(now.getTime() + 20 * 60_000) },
    { label: 'Dans 1 heure', date: new Date(now.getTime() + 60 * 60_000) },
    { label: 'Dans 3 heures', date: new Date(now.getTime() + 3 * 60 * 60_000) },
    { label: 'Demain à 9 h', date: tomorrow },
  ]
}

const REMINDER_INPUT = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})[:h](\d{2})\s*$/

/**
 * Date et heure saisies « JJ/MM/AAAA HH:MM » (heure locale). null si le format est faux, si la date
 * n'existe pas (31/02) ou si elle n'est pas dans le futur.
 */
export function parseReminderInput(text: string, now: Date): Date | null {
  const m = text.match(REMINDER_INPUT)
  if (!m) return null
  const [day, month, year, hour, minute] = m.slice(1).map(Number) as [number, number, number, number, number]
  if (hour > 23 || minute > 59) return null
  const d = new Date(year, month - 1, day, hour, minute, 0, 0)
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null
  return d.getTime() > now.getTime() ? d : null
}

/** « 08/10/2026 09:00 » : valeur de départ du champ de saisie. */
export function formatReminderInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ─── Historique des modifications ─────────────────────────────────────────────

export interface EditEntry {
  content: string | null
  editedAt: string
}

/** GET /messages/:id/edits : [{ content, edited_at }], du plus récent au plus ancien. */
export function normalizeEdits(raw: unknown): EditEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.map(obj).flatMap((r) => {
    const editedAt = str(r.edited_at)
    return editedAt ? [{ content: str(r.content), editedAt }] : []
  })
}
