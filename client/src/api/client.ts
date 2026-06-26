import axios from 'axios'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
export const SERVER_URL = isTauri ? 'https://forgechat.heiphaistos.org' : ''
const baseURL = isTauri ? 'https://forgechat.heiphaistos.org/api' : '/api'

const api = axios.create({
  baseURL,
  // Envoie les cookies httpOnly automatiquement (auth web)
  withCredentials: true,
})

api.interceptors.request.use(cfg => {
  // Tauri uniquement : Bearer token depuis localStorage (les cookies ne traversent pas l'origine Tauri)
  if (isTauri) {
    const token = localStorage.getItem('access_token')
    if (token) cfg.headers.Authorization = `Bearer ${token}`
  }
  return cfg
})

api.interceptors.response.use(
  r => r,
  async err => {
    const url: string = err.config?.url ?? ''
    const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/register') || url.includes('/auth/refresh')
    const publicPaths = ['/', '/login', '/register', '/verify-email']
    const onPublicPage = typeof window !== 'undefined' && publicPaths.includes(window.location.pathname)

    if (err.response?.status === 401 && !isAuthEndpoint && !onPublicPage) {
      try {
        const body = isTauri
          ? { refresh_token: localStorage.getItem('refresh_token') }
          : {}
        const res = await axios.post(`${baseURL}/auth/refresh`, body, { withCredentials: true })
        if (isTauri && res.data.access_token) {
          localStorage.setItem('access_token', res.data.access_token)
          err.config.headers.Authorization = `Bearer ${res.data.access_token}`
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
