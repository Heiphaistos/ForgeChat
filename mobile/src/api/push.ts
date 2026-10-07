import { http, path } from '@/lib/http'

export interface PushRegistration {
  token: string
  platform: 'ios' | 'android'
  provider: 'expo'
  /** Si false, le serveur n'envoie que « Nouveau message » (pas d'aperçu du contenu). */
  show_preview: boolean
  device_name?: string
  /** Secret de cette installation : un jeton déjà lié ne change de compte que depuis le même appareil. */
  device_id?: string
}

export const pushApi = {
  register: (reg: PushRegistration) => http.post('/push/devices', reg),
  unregister: (token: string) => http.delete(path`/push/devices/${token}`),
}
