import { http, path } from '@/lib/http'

/** Son du soundboard (server/src/handlers/soundboard.rs). */
export interface Sound {
  id: string
  name: string
  emoji: string | null
  file_url: string
}

/** Son d'un de mes serveurs (GET /users/me/soundboard). */
export interface MySound extends Sound {
  server_id: string
  server_name: string
}

/** Limites du serveur : 2 Mo, extensions acceptées. */
export const SOUND_MAX_BYTES = 2 * 1024 * 1024
export const SOUND_EXTS = ['mp3', 'wav', 'ogg', 'webm', 'm4a'] as const

export const soundboardApi = {
  list: (serverId: string) => http.get<Sound[]>(path`/servers/${serverId}/soundboard`),
  mine: () => http.get<MySound[]>('/users/me/soundboard'),
  /** Mes sons perso (à moi, jouables dans tous mes salons vocaux). */
  personal: () => http.get<Sound[]>('/users/me/sounds'),
  uploadPersonal: (name: string, file: { uri: string; name: string; type: string }) => {
    const fd = new FormData()
    fd.append('name', name)
    fd.append('file', file as unknown as Blob)
    return http.upload<Sound>('/users/me/sounds', fd)
  },
  deletePersonal: (id: string) => http.delete<unknown>(path`/users/me/sounds/${id}`),
  /** MANAGE_SERVER requis ; le serveur exige un type MIME audio/*. */
  upload: (serverId: string, name: string, file: { uri: string; name: string; type: string }) => {
    const fd = new FormData()
    fd.append('name', name)
    fd.append('file', file as unknown as Blob)
    return http.upload<Sound>(path`/servers/${serverId}/soundboard`, fd)
  },
}
