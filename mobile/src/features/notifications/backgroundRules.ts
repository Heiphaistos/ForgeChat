/**
 * Règles pures du mode « Notifications sans Google » (src/services/keepAlive.ts), testées dans
 * __tests__/background-notify.test.ts. Elles reproduisent celles du push serveur
 * (server/src/notify.rs, handlers/friends.rs, handlers/group_dms.rs) :
 * - message privé : sauf statut « Ne pas déranger » ou conversation en sourdine ;
 * - groupe : chaque message (sourdine du groupe respectée) ;
 * - salon : seulement MENTION_CREATE avec `notify` (le serveur y applique déjà sourdines de
 *   serveur/salon, niveaux de notification, @everyone/@here/rôles, réponses et Ne pas déranger).
 * En plus, comme le web : mode focus et heures calmes coupent tout.
 */

import { t } from '@/i18n'

export interface NotifyContext {
  myId: string | null
  /** Statut « Ne pas déranger ». */
  dnd: boolean
  focus: boolean
  /** Heures calmes en cours. */
  quiet: boolean
  /** Aperçu du contenu autorisé (Réglages > Notifications). */
  preview: boolean
  isMuted: (conversationId: string) => boolean
  /** Nom d'un groupe d'après les conversations en cache. */
  groupName: (groupId: string) => string | null
}

export interface LocalNotice {
  /** Une notification par conversation : la suivante remplace la précédente. */
  id: string
  title: string
  body: string
  /** Lu par routeFromNotification (src/services/push.ts), comme un push serveur. */
  data: Record<string, string>
}

const PREVIEW_MAX = 140
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length < 200 ? v : null)
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

/** Message notifié (réponse rapide, réaction depuis la notification). */
const msgId = (v: unknown): { message_id?: string } => (str(v) ? { message_id: str(v)! } : {})

/** Texte d'aperçu : jetons de mention lisibles, caractères de contrôle retirés, tronqué. */
function clip(content: unknown): string {
  const raw = typeof content === 'string' && content.trim() ? content : t('store.notify.attachment')
  const s = raw.replace(/<@[!&]?[0-9a-f-]{36}>/gi, '@…').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
  return s.length > PREVIEW_MAX ? `${s.slice(0, PREVIEW_MAX)}…` : s
}

/** Notification à afficher pour cet événement temps réel, ou null s'il n'en mérite pas. */
export function noticeFor(e: { type: string; [k: string]: unknown }, c: NotifyContext): LocalNotice | null {
  if (c.focus || c.quiet) return null
  if (e.type === 'DM_MESSAGE' || e.type === 'GROUP_DM_MESSAGE') {
    const group = e.type === 'GROUP_DM_MESSAGE'
    const id = str(group ? e.group_id : e.dm_id)
    const m = obj(e.message)
    if (!id || !m || c.dnd || c.isMuted(id)) return null
    const sender = str(m.sender_username) ?? t('store.notify.someone')
    if (!str(m.sender_id) || m.sender_id === c.myId) return null
    if (!group) {
      return {
        id: `msg:${id}`,
        title: sender,
        body: c.preview ? clip(m.content) : t('store.notify.newDm'),
        data: { kind: 'dm', dm_id: id, ...msgId(m.id) },
      }
    }
    return {
      id: `msg:${id}`,
      title: c.groupName(id) ?? t('store.notify.group'),
      body: c.preview ? t('store.notify.preview', { name: sender, text: clip(m.content) }) : t('store.notify.newGroupMessage', { name: sender }),
      data: { kind: 'group', group_id: id, ...msgId(m.id) },
    }
  }
  if (e.type === 'MENTION_CREATE') {
    const m = obj(e.mention)
    if (e.notify !== true || !m) return null
    const serverId = str(m.server_id)
    const channelId = str(m.channel_id)
    if (!serverId || !channelId || m.author_id === c.myId) return null
    const author = str(m.author_username) ?? t('store.notify.someone')
    return {
      id: `msg:${channelId}`,
      title: `${str(m.server_name) ?? t('store.notify.server')} · #${str(m.channel_name) ?? t('store.voice.channel')}`,
      body: c.preview ? t('store.notify.preview', { name: author, text: clip(m.content) }) : t('store.notify.mentioned', { name: author }),
      data: { kind: 'channel', server_id: serverId, channel_id: channelId, ...msgId(m.message_id) },
    }
  }
  return null
}

/** Heures calmes « HH:MM[:SS] » ; plage traversant minuit gérée (22:00 → 08:00). Même règle que le web. */
export function inQuietHours(start: string | null | undefined, end: string | null | undefined, now: Date): boolean {
  const toMin = (t: string | null | undefined) => {
    const m = t?.match(/^(\d{2}):(\d{2})/)
    return m ? Number(m[1]) * 60 + Number(m[2]) : null
  }
  const s = toMin(start)
  const e = toMin(end)
  if (s === null || e === null) return false
  const n = now.getHours() * 60 + now.getMinutes()
  return s <= e ? n >= s && n < e : n >= s || n < e
}

/**
 * Mode actif ? Le choix de l'utilisateur s'il en a fait un ; sinon actif seulement sans jeton push
 * (build sans Firebase, permission refusée…) : avec un jeton, le push Expo suffit.
 */
export function keepConnectedEnabled(choice: boolean | null | undefined, hasPushToken: boolean): boolean {
  return choice ?? !hasPushToken
}
