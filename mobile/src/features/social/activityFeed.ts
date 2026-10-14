import type { IconName } from '@/components/ui'
import { isUuid } from '@/lib/params'

/** Les 3 types réellement produits par users.rs::get_activity_feed (48 h, serveurs communs). */
export type ActivityType = 'server_join' | 'friend_join_server' | 'message_pin'
export type ActivityFilter = 'all' | 'friends' | 'servers'

export interface ActivityItem {
  id: string
  type: ActivityType
  actorId: string
  actor: string
  serverName: string | null
  serverId: string | null
  channelId: string | null
  channelName: string | null
  timestamp: string
}

const TYPES: readonly string[] = ['server_join', 'friend_join_server', 'message_pin']
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const str = (v: unknown) => (typeof v === 'string' && v ? v : null)

/** Lit la réponse, écarte les types inconnus (futurs) et les lignes sans acteur ni date. */
export function normalizeActivity(raw: unknown): ActivityItem[] {
  if (!Array.isArray(raw)) return []
  return raw.map(obj).flatMap((r, i) => {
    const actor = obj(r.actor)
    const server = obj(r.server)
    const channel = obj(r.channel)
    const ts = str(r.timestamp)
    if (!TYPES.includes(r.type as string) || !isUuid(actor.id) || !str(actor.username) || !ts) return []
    return [
      {
        id: str(r.id) ?? `${i}`,
        type: r.type as ActivityType,
        actorId: actor.id.toLowerCase(),
        actor: actor.username as string,
        serverName: str(server.name),
        serverId: isUuid(server.id) ? server.id.toLowerCase() : null,
        channelId: isUuid(channel.id) ? channel.id.toLowerCase() : null,
        channelName: str(channel.name),
        timestamp: ts,
      },
    ]
  })
}

/** Mêmes filtres que le web : Amis = arrivées d'amis ; Serveurs = arrivées et épingles. */
export function filterActivity(items: ActivityItem[], f: ActivityFilter): ActivityItem[] {
  if (f === 'friends') return items.filter((i) => i.type === 'friend_join_server')
  if (f === 'servers') return items.filter((i) => i.type !== 'friend_join_server')
  return items
}

export const ACTIVITY_ICON: Record<ActivityType, IconName> = {
  server_join: 'people-outline',
  friend_join_server: 'person-add-outline',
  message_pin: 'pin-outline',
}
