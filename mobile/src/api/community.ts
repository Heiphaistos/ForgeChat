import { http, path } from '@/lib/http'

/** Lot « Serveurs et communauté » (handlers levels/community/tickets/automod/stats/directory.rs). */

export interface LevelSettings { enabled: boolean; xp_per_message: number; xp_per_voice_minute: number; roles: { level: number; role_id: string }[] }
export interface LevelMember {
  user_id: string
  username: string
  avatar: string | null
  xp: number
  level: number
  level_xp: number
  next_level_xp: number
  messages: number
  voice_minutes: number
  rank: number
}
export interface StarboardSettings { enabled: boolean; channel_id: string | null; emoji: string; threshold: number }
export interface WelcomeSettings { enabled: boolean; channel_id: string | null; text: string }
export interface TicketSettings { enabled: boolean; category_id: string | null; staff_role_ids: string[]; is_staff?: boolean }
export interface Ticket {
  id: string
  title: string
  number: number | null
  status: 'open' | 'in_progress' | 'resolved' | 'closed'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  creator_id: string
  channel_id: string | null
  created_at: string
}
export interface AutoModAdvanced {
  rate_limit_count: number
  rate_limit_seconds: number
  raid_join_count: number
  raid_join_seconds: number
  block_dangerous_links: boolean
  blocked_domains: string[]
  lockdown?: boolean
  lockdown_reason?: string | null
  builtin_domains?: number
}
export interface StatsHistory {
  member_count: number
  in_voice_now: number
  series: { day: string; messages: number; joins: number; leaves: number; members: number; voice_minutes: number; voice_peak: number }[]
  channels: { id: string; name: string; messages: number; authors: number }[]
}
export interface DirectoryServer {
  id: string
  name: string
  icon: string | null
  description: string | null
  member_count: number
  online_count: number
  activity: number
  invite_code: string | null
  category: string | null
  tags: string[]
}
const setting = <T>(name: string) => ({
  get: (sid: string) => http.get<T>(`${path`/servers/${sid}`}/${name}`),
  put: (sid: string, v: T) => http.put(`${path`/servers/${sid}`}/${name}`, v),
})

export const communityApi = {
  levels: setting<LevelSettings>('levels'),
  starboard: setting<StarboardSettings>('starboard'),
  welcome: setting<WelcomeSettings>('welcome'),
  ticketSettings: setting<TicketSettings>('tickets/settings'),
  automodAdvanced: setting<AutoModAdvanced>('automod/advanced'),
  leaderboard: (sid: string) => http.get<LevelMember[]>(path`/servers/${sid}/levels/leaderboard`, { query: { limit: 50 } }),
  levelCard: (sid: string, uid: string) => http.get<LevelMember>(path`/servers/${sid}/levels/members/${uid}`),
  tickets: (sid: string) => http.get<Ticket[]>(path`/servers/${sid}/tickets`),
  /** Aucun texte : le sujet part chiffré comme premier message du salon du ticket. */
  openTicket: (sid: string, priority: string) => http.post<Ticket>(path`/servers/${sid}/tickets`, { priority }),
  setTicketStatus: (sid: string, id: string, status: Ticket['status']) => http.patch<Ticket>(path`/servers/${sid}/tickets/${id}`, { status }),
  lockdown: (sid: string, enabled: boolean) => http.put(path`/servers/${sid}/lockdown`, { enabled }),
  stats: (sid: string, days: number) => http.get<StatsHistory>(path`/servers/${sid}/stats/history`, { query: { days } }),
  directory: (q: { category?: string; tag?: string; q?: string; sort?: string }) => http.get<DirectoryServer[]>('/explore', { query: q }),
  setTags: (sid: string, tags: string[]) => http.patch(path`/servers/${sid}`, { discovery_tags: tags }),
}
