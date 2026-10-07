import { http, path } from '@/lib/http'

export interface ModNote {
  id: string
  moderator_id: string
  note: string
  created_at: string
}

export type ReportStatus = 'pending' | 'resolved' | 'dismissed'
export interface Report {
  id: string
  reason: string
  comment: string | null
  status: ReportStatus
  created_at: string
  message_id: string
  message_content: string | null
  reporter_username: string
  reporter_id: string
}

export interface AuditEntry {
  id: string
  action: string
  user_id: string | null
  username: string | null
  target_id: string | null
  target_name: string | null
  details: unknown
  created_at: string
}

/** Règles AutoMod (audit.rs::AutoModConfig) : mentions 0-50, liens 0-20, 200 mots max ; 0 = sans limite. */
export interface AutoMod {
  enabled: boolean
  blocked_words: string[]
  max_mentions: number
  max_links: number
  anti_spam: boolean
  anti_caps: boolean
}

export interface ServerStats {
  member_count: number
  online_count: number
  message_count_today: number
  message_count_week: number
  new_members_today: number
  new_members_week: number
  channel_count: number
  top_channels: { id: string; name: string; messages: number }[]
  active_hours: number[]
}

export interface Webhook {
  id: string
  channel_id: string
  name: string
  token_preview: string
  /** Présent uniquement dans la réponse de création. */
  token: string | null
  created_at: string
}

export interface ClanTag {
  id: string
  name: string
  color: number
}

export interface DetailedMember {
  user_id: string
  username: string
  avatar: string | null
  status: string
  nickname: string | null
  is_owner: boolean
  joined_at: string
  roles: { id: string; name: string; color: number }[]
  tags: ClanTag[]
}

/** Participant de GET /voice/state (handlers/voice.rs). */
export interface VoiceParticipant {
  user_id: string
  server_muted: boolean
  server_deafened: boolean
}
export interface VoiceChannelState {
  channel_id: string
  server_id: string | null
  participants: VoiceParticipant[]
}

type Upload = { uri: string; name: string; type: string }
const form = (fields: Record<string, string | Upload>) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v as unknown as Blob)
  return fd
}

/** Outils de modération et d'administration d'un serveur (routes de server/src/main.rs). */
export const moderationApi = {
  /** Muet / sourdine imposés, déplacement ou déconnexion (handlers/voice_moderation.rs). */
  voice: (serverId: string, userId: string, body: { mute?: boolean; deafen?: boolean; channel_id?: string; disconnect?: boolean }) =>
    http.patch<{ server_muted: boolean; server_deafened: boolean }>(path`/servers/${serverId}/members/${userId}/voice`, body),
  voiceState: () => http.get<{ channels: VoiceChannelState[] }>('/voice/state'),
  notes: (serverId: string, userId: string) => http.get<ModNote[]>(path`/servers/${serverId}/members/${userId}/notes`),
  addNote: (serverId: string, userId: string, note: string) => http.post<ModNote>(path`/servers/${serverId}/members/${userId}/notes`, { note: note.trim() }),
  deleteNote: (serverId: string, noteId: string) => http.delete(path`/servers/${serverId}/notes/${noteId}`),
  reports: (serverId: string) => http.get<Report[]>(path`/servers/${serverId}/reports`),
  setReport: (serverId: string, reportId: string, status: ReportStatus) => http.patch(path`/servers/${serverId}/reports/${reportId}`, { status }),
  /** `q` : recherche dans l'auteur, la cible et l'action (audit_search.rs). */
  audit: (serverId: string, opts: { q?: string; limit?: number } = {}) =>
    http.get<AuditEntry[]>(path`/servers/${serverId}/audit`, { query: { limit: 100, ...opts } }),
  automod: (serverId: string) => http.get<AutoMod>(path`/servers/${serverId}/automod`),
  setAutomod: (serverId: string, cfg: AutoMod) => http.put(path`/servers/${serverId}/automod`, cfg),
  stats: (serverId: string) => http.get<ServerStats>(path`/servers/${serverId}/stats`),
  membersDetailed: (serverId: string) => http.get<DetailedMember[]>(path`/servers/${serverId}/members/detailed`),
  webhooks: (serverId: string) => http.get<Webhook[]>(path`/servers/${serverId}/webhooks`),
  createWebhook: (serverId: string, name: string, channelId: string) =>
    http.post<Webhook>(path`/servers/${serverId}/webhooks`, { name: name.trim(), channel_id: channelId }),
  deleteWebhook: (serverId: string, id: string) => http.delete(path`/servers/${serverId}/webhooks/${id}`),
  tags: (serverId: string) => http.get<ClanTag[]>(path`/servers/${serverId}/tags`),
  createTag: (serverId: string, name: string, color: number) => http.post<ClanTag>(path`/servers/${serverId}/tags`, { name: name.trim(), color }),
  deleteTag: (serverId: string, id: string) => http.delete(path`/servers/${serverId}/tags/${id}`),
  assignTag: (serverId: string, userId: string, tagId: string) => http.put(path`/servers/${serverId}/members/${userId}/tags/${tagId}`),
  removeTag: (serverId: string, userId: string, tagId: string) => http.delete(path`/servers/${serverId}/members/${userId}/tags/${tagId}`),
  /** Emoji : nom 1-32 [a-z0-9_], image 256 Ko (GIF 512 Ko). */
  createEmoji: (serverId: string, name: string, file: Upload) => http.upload(path`/servers/${serverId}/emojis`, form({ name, file })),
  deleteEmoji: (serverId: string, id: string) => http.delete(path`/servers/${serverId}/emojis/${id}`),
  /** Sticker : nom 1-50, PNG / WEBP / GIF, 2 Mo. */
  createSticker: (serverId: string, name: string, file: Upload) => http.upload(path`/servers/${serverId}/stickers`, form({ name, file })),
  deleteSticker: (serverId: string, id: string) => http.delete(path`/servers/${serverId}/stickers/${id}`),
}
