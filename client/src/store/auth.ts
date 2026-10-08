import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import api from '../api/client'
import { clearLocalSession } from '../lib/localSession'
import { useChat, useDraft } from './chat'
import { usePresence } from './presence'
import { useUnread } from './unread'
import { useWs } from './ws'
import { useChannelNotif, EMPTY_NOTIF_STATE } from './channelNotif'
import { disableWebPush } from '../utils/webPush'
import { listAccounts } from '../lib/accounts'
import { forgetOfflineData } from '../lib/offline'
import { queryClient } from '../main'
import { clearAccountKey, rememberPassword } from '../e2e/accountKey'
import { clearSearchIndex } from '../e2e/searchIndex'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

interface User {
  id: string
  username: string
  discriminator: string
  avatar: string | null
  banner: string | null
  banner_url?: string
  bio: string | null
  status: string
  custom_status: string | null
  custom_status_emoji?: string | null
  custom_status_expires_at?: string | null
  display_name?: string | null
  /** Activité (jeu détecté, musique saisie à la main…). */
  activity_type?: string | null
  activity_name?: string | null
  email?: string
  focus_mode?: boolean
  verified?: boolean
}

interface AuthState {
  user: User | null
  loading: boolean
  login: (email: string, password: string, totpCode?: string) => Promise<void>
  register: (username: string, email: string, password: string, inviteCode?: string) => Promise<void>
  logout: () => Promise<void>
  fetchMe: () => Promise<void>
  updateMe: (data: Partial<User>) => void
}

export const useAuth = create<AuthState>()(
  immer((set) => ({
    user: null,
    loading: true,

    login: async (email, password, totpCode) => {
      const body: any = { email, password }
      if (totpCode) body.totp_code = totpCode
      const { data } = await api.post('/auth/login', body)
      rememberPassword(password)
      // Web : tokens dans les cookies httpOnly (automatiques via withCredentials)
      // Tauri : tokens dans localStorage (les cookies cross-origin ne sont pas garantis)
      if (isTauri) {
        localStorage.setItem('access_token', data.access_token)
        localStorage.setItem('refresh_token', data.refresh_token)
      }
      set(s => { s.user = data.user })
    },

    register: async (username, email, password, inviteCode) => {
      const { data } = await api.post('/auth/register', { username, email, password, ...(inviteCode?.trim() ? { invite_code: inviteCode.trim() } : {}) })
      rememberPassword(password)
      if (isTauri) {
        localStorage.setItem('access_token', data.access_token)
        localStorage.setItem('refresh_token', data.refresh_token)
      }
      set(s => { s.user = data.user })
    },

    logout: async () => {
      const body = isTauri ? { refresh_token: localStorage.getItem('refresh_token') } : {}
      // Avant la déconnexion (route authentifiée) : ce navigateur ne doit plus
      // recevoir les notifications push de ce compte.
      await disableWebPush((await listAccounts()).length > 0)
      await api.post('/auth/logout', body).catch(() => {})
      if (isTauri) clearLocalSession()
      const uid = useAuth.getState().user?.id
      await clearAccountKey(uid)
      if (uid) await forgetOfflineData(uid)
      // Aucun texte déchiffré ne reste sur l'appareil : index de recherche et brouillons (resynchronisés à la connexion).
      await clearSearchIndex()
      useDraft.setState({ drafts: {} })
      useWs.getState().disconnect()
      useChat.setState({ messagesByChannel: {}, typing: {} })
      usePresence.setState({ statuses: {}, activities: {} })
      useUnread.getState().clearAll()
      useChannelNotif.setState(EMPTY_NOTIF_STATE)
      set(s => { s.user = null })
      // Sans ça, le compte suivant connecté dans le même onglet voit les serveurs,
      // MP et amis du précédent tant que le cache n'est pas périmé.
      queryClient.clear()
    },

    fetchMe: async () => {
      // Web : le cookie httpOnly est envoyé automatiquement
      // Tauri : le Bearer token est injecté par l'interceptor axios
      const hasSession = isTauri ? !!localStorage.getItem('access_token') : true
      if (!hasSession) { set(s => { s.loading = false }); return }
      // Réseau instable au lancement (réveil de veille, Wi-Fi qui s'accroche) : on réessaie un peu avant
      // d'abandonner, et on ne touche JAMAIS à la session sur une simple erreur réseau.
      for (let attempt = 0; ; attempt++) {
        try {
          const { data } = await api.get('/users/me')
          set(s => { s.user = data; s.loading = false })
          return
        } catch (err: any) {
          const status = err?.response?.status
          if ((status === 401 || status === 403) && !err?.sessionKept) {
            // Refus définitif (l'intercepteur a déjà tenté le rafraîchissement).
            if (isTauri) clearLocalSession()
            break
          }
          if (attempt >= 3) {
            // Toujours injoignable : l'écran de connexion s'affiche, la session reste enregistrée et
            // reprend toute seule au retour du réseau (voir l'écouteur « online » plus bas).
            break
          }
          await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
        }
      }
      set(s => { s.loading = false })
    },

    updateMe: (data) => set(s => { if (s.user) Object.assign(s.user, data) }),
  }))
)

// Bureau : la session enregistrée reprend d'elle-même quand le réseau revient (lancement hors ligne).
if (isTauri && typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    const { user, fetchMe } = useAuth.getState()
    if (!user && localStorage.getItem('refresh_token')) void fetchMe()
  })
}
