// Actions des notifications de message (règles pures, testées dans __tests__/quick-actions.test.ts).
import type { ConversationRef } from '@/types/models'

/** Catégorie des notifications de message (push serveur `categoryId`, notifications locales). */
export const MESSAGE_CATEGORY = 'message'
export const REPLY_ACTION = 'reply'
export const REACTION_ACTIONS = [
  { id: 'react_like', emoji: '👍' },
  { id: 'react_love', emoji: '❤️' },
] as const

export type QuickAction = { kind: 'reply' } | { kind: 'react'; emoji: string }

export function actionFromIdentifier(id: string): QuickAction | null {
  if (id === REPLY_ACTION) return { kind: 'reply' }
  const r = REACTION_ACTIONS.find((a) => a.id === id)
  return r ? { kind: 'react', emoji: r.emoji } : null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const id = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : null)

/** Conversation désignée par les données d'une notification (push serveur ou locale), identifiants revalidés. */
export function refFromNotificationData(d: Record<string, unknown>): ConversationRef | null {
  if (d.kind === 'dm' && id(d.dm_id)) return { kind: 'dm', dmId: id(d.dm_id)! }
  if (d.kind === 'group' && id(d.group_id)) return { kind: 'group', groupId: id(d.group_id)! }
  if (d.kind === 'channel' && id(d.server_id) && id(d.channel_id)) return { kind: 'channel', serverId: id(d.server_id)!, channelId: id(d.channel_id)! }
  return null
}
