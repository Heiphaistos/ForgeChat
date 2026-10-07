import { http, path } from '@/lib/http'

export type Rsvp = 'interested' | 'going' | 'not_going'

/** Événement de serveur (handlers/events.rs::ServerEvent). */
export interface ServerEvent {
  id: string
  server_id: string
  channel_id: string | null
  name: string
  description: string | null
  event_type: string
  start_time: string
  end_time: string | null
  creator_id: string
  max_attendees: number | null
  attendee_count: number | null
  user_rsvp: Rsvp | null
  /** none | daily | weekly | monthly : l'occurrence passée est reportée par le serveur. */
  recurrence?: string
  /** Rappel N minutes avant (notification aux participants). */
  reminder_minutes?: number | null
}

export const eventsApi = {
  list: (serverId: string, filter: 'upcoming' | 'past') => http.get<ServerEvent[]>(path`/servers/${serverId}/events`, { query: { filter } }),
  /** Tout membre non exclu ; début dans le futur ; type event | meeting | stream | other. */
  create: (serverId: string, body: { name: string; description?: string; event_type: string; start_time: string; end_time?: string; channel_id?: string; max_attendees?: number; recurrence?: string; reminder_minutes?: number }) =>
    http.post<ServerEvent>(path`/servers/${serverId}/events`, body),
  /** Créateur ou MANAGE_SERVER. */
  remove: (serverId: string, eventId: string) => http.delete(path`/servers/${serverId}/events/${eventId}`),
  attend: (eventId: string, status: Rsvp) => http.post(path`/events/${eventId}/attend`, { status }),
}
