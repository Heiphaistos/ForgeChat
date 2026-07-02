import axios from 'axios'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
export const SERVER_URL = isTauri ? 'https://forgechat.heiphaistos.org' : ''
const baseURL = isTauri ? 'https://forgechat.heiphaistos.org/api' : '/api'

const api = axios.create({
  baseURL,
  // Envoie les cookies httpOnly automatiquement (auth web)
  withCredentials: true,
  timeout: 30_000,
})

api.interceptors.request.use(cfg => {
  // Tauri uniquement : Bearer token depuis localStorage (les cookies ne traversent pas l'origine Tauri)
  if (isTauri) {
    const token = localStorage.getItem('access_token')
    if (token) cfg.headers.Authorization = `Bearer ${token}`
  }
  return cfg
})

// Semaphore: une seule tentative de refresh à la fois, les autres attendent
let refreshPromise: Promise<void> | null = null

api.interceptors.response.use(
  r => r,
  async err => {
    const url: string = err.config?.url ?? ''
    const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/register') || url.includes('/auth/refresh')
    const publicPaths = ['/', '/login', '/register', '/verify-email']
    const onPublicPage = typeof window !== 'undefined' && publicPaths.includes(window.location.pathname)

    if (err.response?.status === 401 && !isAuthEndpoint && !onPublicPage) {
      try {
        if (!refreshPromise) {
          refreshPromise = (async () => {
            const body = isTauri
              ? { refresh_token: localStorage.getItem('refresh_token') }
              : {}
            const res = await axios.post(`${baseURL}/auth/refresh`, body, { withCredentials: true })
            if (isTauri && res.data.access_token) {
              localStorage.setItem('access_token', res.data.access_token)
              if (res.data.refresh_token) localStorage.setItem('refresh_token', res.data.refresh_token)
            }
          })().finally(() => { refreshPromise = null })
        }
        await refreshPromise
        // Mettre à jour le header si Tauri
        if (isTauri) {
          const token = localStorage.getItem('access_token')
          if (token) err.config.headers.Authorization = `Bearer ${token}`
        }
        return api(err.config)
      } catch {
        if (isTauri) localStorage.clear()
        if (!onPublicPage) window.location.href = '/login'
      }
    }
    return Promise.reject(err)
  }
)

export default api
