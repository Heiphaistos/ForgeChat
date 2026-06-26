import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import api from '../api/client'
import { useChat } from './chat'
import { usePresence } from './presence'
import { useUnread } from './unread'
import { useWs } from './ws'

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
  email?: string
  focus_mode?: boolean
  verified?: boolean
}

interface AuthState {
  user: User | null
  loading: boolean
  login: (email: string, password: string, totpCode?: string) => Promise<void>
  register: (username: string, email: string, password: string) => Promise<void>
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
      // Web : tokens dans les cookies httpOnly (automatiques via withCredentials)
      // Tauri : tokens dans localStorage (les cookies cross-origin ne sont pas garantis)
      if (isTauri) {
        localStorage.setItem('access_token', data.access_token)
        localStorage.setItem('refresh_token', data.refresh_token)
      }
      set(s => { s.user = data.user })
    },

    register: async (username, email, password) => {
      const { data } = await api.post('/auth/register', { username, email, password })
      if (isTauri) {
        localStorage.setItem('access_token', data.access_token)
        localStorage.setItem('refresh_token', data.refresh_token)
      }
      set(s => { s.user = data.user })
    },

    logout: async () => {
      const body = isTauri ? { refresh_token: localStorage.getItem('refresh_token') } : {}
      await api.post('/auth/logout', body).catch(() => {})
      if (isTauri) localStorage.clear()
      useWs.getState().disconnect()
      useChat.setState({ messagesByChannel: {}, typing: {} })
      usePresence.setState({ statuses: new Map(), activities: new Map() })
      useUnread.setState({ counts: {} })
      set(s => { s.user = null })
    },

    fetchMe: async () => {
      // Web : le cookie httpOnly est envoyé automatiquement
      // Tauri : le Bearer token est injecté par l'interceptor axios
      const hasSession = isTauri ? !!localStorage.getItem('access_token') : true
      if (!hasSession) { set(s => { s.loading = false }); return }
      try {
        const { data } = await api.get('/users/me')
        set(s => { s.user = data; s.loading = false })
      } catch {
        if (isTauri) localStorage.clear()
        set(s => { s.loading = false })
      }
    },

    updateMe: (data) => set(s => { if (s.user) Object.assign(s.user, data) }),
  }))
)
