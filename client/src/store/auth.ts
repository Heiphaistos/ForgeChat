import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import api from '../api/client'

interface User {
  id: string
  username: string
  discriminator: string
  avatar: string | null
  banner: string | null
  bio: string | null
  status: string
  custom_status: string | null
}

interface AuthState {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (username: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  fetchMe: () => Promise<void>
  updateMe: (data: Partial<User>) => void
}

export const useAuth = create<AuthState>()(
  immer((set) => ({
    user: null,
    loading: true,

    login: async (email, password) => {
      const { data } = await api.post('/auth/login', { email, password })
      localStorage.setItem('access_token', data.access_token)
      localStorage.setItem('refresh_token', data.refresh_token)
      set(s => { s.user = data.user })
    },

    register: async (username, email, password) => {
      const { data } = await api.post('/auth/register', { username, email, password })
      localStorage.setItem('access_token', data.access_token)
      localStorage.setItem('refresh_token', data.refresh_token)
      set(s => { s.user = data.user })
    },

    logout: async () => {
      const refresh_token = localStorage.getItem('refresh_token')
      await api.post('/auth/logout', { refresh_token }).catch(() => {})
      localStorage.clear()
      set(s => { s.user = null })
    },

    fetchMe: async () => {
      const token = localStorage.getItem('access_token')
      if (!token) { set(s => { s.loading = false }); return }
      try {
        const { data } = await api.get('/users/me')
        set(s => { s.user = data; s.loading = false })
      } catch {
        set(s => { s.loading = false })
      }
    },

    updateMe: (data) => set(s => { if (s.user) Object.assign(s.user, data) }),
  }))
)
