import { http } from '@/lib/http'

export type Audience = 'everyone' | 'friends' | 'nobody'
export type FriendRequestFrom = 'everyone' | 'friends_of_friends' | 'nobody'
export type ExplicitFilter = 'none' | 'members_without_roles' | 'all'

/** Sous-ensemble de user_settings.rs utilisé par le mobile (le PUT est partiel). */
export interface ServerSideSettings {
  show_online: boolean
  dm_from_all: boolean
  activity_visibility: Audience
  /** « En appel » (lot « Profil et social »). */
  call_visibility: Audience
  friend_request_from: FriendRequestFrom
  explicit_content_filter: ExplicitFilter
  quiet_hours_enabled: boolean
  /** « HH:MM:SS » (TIME Postgres) ou null. */
  quiet_hours_start: string | null
  quiet_hours_end: string | null
  /** Apparence partagée avec le web (le thème lui-même : /user/theme). */
  accent_color: string | null
  time_format: string
  streamer_mode: boolean
  /** Aperçus de liens dans les messages (réglage partagé avec le web). */
  link_preview?: boolean
  /** Langue de l'interface (fr, en…), partagée avec le web et le bureau. */
  language: string
}

export const settingsKey = ['user-settings'] as const
export const emailPrefsKey = ['email-prefs'] as const

export const settingsApi = {
  get: () => http.get<ServerSideSettings>('/user/settings'),
  /** Seuls les champs envoyés sont modifiés. */
  update: (patch: Partial<ServerSideSettings>) => http.put<ServerSideSettings>('/user/settings', patch),
  /** Thème partagé avec le web et le bureau (null : jamais choisi). */
  theme: () => http.get<{ theme: string | null }>('/user/theme'),
  setTheme: (theme: string) => http.put<{ ok: boolean }>('/user/theme', { theme }),
  /** Thèmes perso et disposition du compte (validés à la lecture : features/appearance/sync.ts). */
  themeStudio: () => http.get<{ customs?: unknown; layout?: unknown } | null>('/user/theme-studio'),
  emailPrefs: () => http.get<{ dm_unread_notify: boolean }>('/user/email-prefs'),
  setEmailPrefs: (dmUnreadNotify: boolean) =>
    http.put<{ dm_unread_notify: boolean }>('/user/email-prefs', { dm_unread_notify: dmUnreadNotify }),
}
