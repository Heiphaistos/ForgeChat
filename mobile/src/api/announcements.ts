import { http, path } from '@/lib/http'

/** Salon d'une destination possible (announcements.rs::follow_targets). */
export interface FollowTarget {
  server_id: string
  server_name: string
  channels: { id: string; name: string }[]
}
export interface Follow {
  id: string
  server_name: string
  channel_name: string
}

/** Suivi des salons d'annonces (crosspost) : server/src/handlers/announcements.rs. */
export const announcementsApi = {
  targets: (channelId: string) => http.get<FollowTarget[]>(path`/channels/${channelId}/follow-targets`),
  follow: (channelId: string, targetChannelId: string) => http.post<{ id: string }>(path`/channels/${channelId}/follow`, { target_channel_id: targetChannelId }),
  follows: (channelId: string) => http.get<{ followers: Follow[]; following: Follow[] }>(path`/channels/${channelId}/follows`),
  unfollow: (followId: string) => http.delete<{ ok: boolean }>(path`/channel-follows/${followId}`),
  publish: (serverId: string, channelId: string, messageId: string) =>
    http.post<{ ok: boolean; delivered: number }>(path`/servers/${serverId}/channels/${channelId}/messages/${messageId}/crosspost`),
}
