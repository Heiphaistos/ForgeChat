import { t, type Key } from '@/i18n'
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
 * Message chiffré : jamais de copie du texte (l'appli déchiffre l'original à la lecture).
 */
export function savedBody(ref: ConversationRef, m: ChatMessage) {
  if (ref.kind === 'group') throw new Error('Messages de groupe non enregistrables')
  return {
    message_id: m.id,
    channel_id: ref.kind === 'channel' ? ref.channelId : ref.dmId,
    server_id: ref.kind === 'channel' ? ref.serverId : null,
    content: m.e2e ? null : m.content,
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
  label: Key
  date: Date
}

/** Choix rapides : 20 min, 1 h, 3 h, demain 9 h (heure locale). */
export function reminderPresets(now: Date): ReminderPreset[] {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0)
  return [
    { label: 'panel.schedule.in20m', date: new Date(now.getTime() + 20 * 60_000) },
    { label: 'panel.schedule.in1h', date: new Date(now.getTime() + 60 * 60_000) },
    { label: 'panel.schedule.in3h', date: new Date(now.getTime() + 3 * 60 * 60_000) },
    { label: 'panel.schedule.tomorrow9', date: tomorrow },
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

// ─── Lien, traduction, réactions ──────────────────────────────────────────────

/** Lien partageable d'un message, même format que le web (MessageList.tsx / utils/searchLink.ts). */
export function messageLink(origin: string, ref: ConversationRef, messageId: string): string {
  const q = `?highlight=${messageId}`
  switch (ref.kind) {
    case 'channel':
      return `${origin}/servers/${ref.serverId}/channels/${ref.channelId}${q}`
    case 'dm':
      return `${origin}/dms/${ref.dmId}${q}`
    case 'group':
      return `${origin}/dms/groups/${ref.groupId}${q}`
  }
}

/**
 * Traduire (messages.rs::translate_message) et « qui a réagi » (audit.rs::get_reaction_detail)
 * ne cherchent le message que dans les salons et les DM 1:1 : rien pour les groupes.
 */
export const supportsTranslate = supportsMessageExtras
export const supportsReactionDetail = supportsMessageExtras

export interface ReactionUser {
  id: string
  username: string
  avatar: string | null
}

/** GET /reactions?message_id=&emoji= : { emoji, count, users: [{ user_id, username, avatar }] }. */
export function normalizeReactionUsers(raw: unknown): ReactionUser[] {
  const users = obj(raw).users
  if (!Array.isArray(users)) return []
  return users.map(obj).flatMap((u) => {
    const id = str(u.user_id)
    const username = str(u.username)
    return isUuid(id) && username ? [{ id: id.toLowerCase(), username, avatar: str(u.avatar) }] : []
  })
}

// ─── Messages programmés (handlers/scheduled.rs) ──────────────────────────────

export interface ScheduledItem {
  id: string
  content: string
  sendAt: string
}

/** Bornes du serveur : dans le futur, au plus 30 jours. */
export const SCHEDULE_MAX_DAYS = 30

export function normalizeScheduled(raw: unknown): ScheduledItem[] {
  if (!Array.isArray(raw)) return []
  return raw.map(obj).flatMap((r) => {
    const id = str(r.id)
    const sendAt = str(r.send_at)
    return isUuid(id) && sendAt && r.sent !== true ? [{ id: id.toLowerCase(), content: str(r.content) ?? '', sendAt }] : []
  })
}

/** Raison du refus (traduite) ou null si la date est acceptée par create_scheduled. */
export function scheduleDateError(at: Date | null, now: Date): string | null {
  if (!at) return t('panel.schedule.errFormat')
  if (at.getTime() <= now.getTime()) return t('panel.schedule.errPast')
  if (at.getTime() > now.getTime() + SCHEDULE_MAX_DAYS * 86_400_000) return t('panel.schedule.errTooFar', { days: SCHEDULE_MAX_DAYS })
  return null
}

// ─── Aperçu de lien (audit.rs::og_preview) ────────────────────────────────────

export interface LinkPreviewData {
  title: string | null
  description: string | null
  siteName: string | null
  url: string
}

/** null si rien d'affichable (ni titre ni description) — comme LinkPreview.tsx. */
export function normalizeOg(raw: unknown, requested: string): LinkPreviewData | null {
  const r = obj(raw)
  const title = str(r.title)?.trim() || null
  const description = str(r.description)?.trim() || null
  if (!title && !description) return null
  return { title, description, siteName: str(r.site_name)?.trim() || null, url: str(r.url) ?? requested }
}
