import { http } from '@/lib/http'

export type Audience = 'everyone' | 'friends' | 'nobody'
export type FriendRequestFrom = 'everyone' | 'friends_of_friends' | 'nobody'
export type ExplicitFilter = 'none' | 'members_without_roles' | 'all'

/** Sous-ensemble de user_settings.rs utilisé par le mobile (le PUT est partiel). */
export interface ServerSideSettings {
  show_online: boolean
  dm_from_all: boolean
  activity_visibility: Audience
  friend_request_from: FriendRequestFrom
  explicit_content_filter: ExplicitFilter
  quiet_hours_enabled: boolean
  /** « HH:MM:SS » (TIME Postgres) ou null. */
  quiet_hours_start: string | null
  quiet_hours_end: string | null
}

export const settingsKey = ['user-settings'] as const
export const emailPrefsKey = ['email-prefs'] as const

export const settingsApi = {
  get: () => http.get<ServerSideSettings>('/user/settings'),
  /** Seuls les champs envoyés sont modifiés. */
  update: (patch: Partial<ServerSideSettings>) => http.put<ServerSideSettings>('/user/settings', patch),
  emailPrefs: () => http.get<{ dm_unread_notify: boolean }>('/user/email-prefs'),
  setEmailPrefs: (dmUnreadNotify: boolean) =>
    http.put<{ dm_unread_notify: boolean }>('/user/email-prefs', { dm_unread_notify: dmUnreadNotify }),
}
