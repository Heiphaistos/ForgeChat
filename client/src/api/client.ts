import axios from 'axios'
import { create } from 'zustand'
import { accessToken, clearLocalSession, refreshAccess } from '../lib/localSession'
import { installOffline } from '../lib/offline'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
export const SERVER_URL = isTauri ? 'https://forgechat.heiphaistos.org' : ''
export const baseURL = isTauri ? 'https://forgechat.heiphaistos.org/api' : '/api'

// Le serveur renvoie des chemins relatifs `/uploads/...`. L'app bureau sert le client
// depuis `tauri.localhost` : sans préfixe, avatars, pièces jointes et sons y pointeraient.
// Adresse venue du serveur : chemin relatif, http(s), blob: (fichier déchiffré) ou image data: ;
// tout autre schéma (javascript:…) est refusé, elle finit souvent dans un `href`.
export function mediaUrl(u: string | null | undefined): string | undefined {
  if (!u) return undefined
  if (!/^(\/(?!\/)|https?:|blob:|data:image\/)/i.test(u)) return undefined
  return SERVER_URL && u.startsWith('/uploads/') ? SERVER_URL + u : u
}

const api = axios.create({
  baseURL,
  // Envoie les cookies httpOnly automatiquement (auth web)
  withCredentials: true,
  timeout: 30_000,
  // Web : jetons en cookies HttpOnly seulement, jamais dans le corps JSON (login, verify-email,
  // refresh). Bureau (Tauri) : pas d'en-tête, Rust a besoin des jetons du corps pour le trousseau.
  ...(isTauri ? {} : { headers: { 'X-ForgeChat-Tokens': 'cookie' } }),
})

api.interceptors.request.use(cfg => {
  // Tauri uniquement : jeton d'accès en mémoire (les cookies ne traversent pas l'origine Tauri)
  if (isTauri) {
    const token = accessToken()
    if (token) cfg.headers.Authorization = `Bearer ${token}`
  }
  return cfg
})

/** 503 (Redis coupé, refus de sécurité) : bannière et nouvel essai, jamais de déconnexion. */
export const useServerStatus = create<{ unavailable: boolean }>(() => ({ unavailable: false }))
const MAX_503_RETRIES = 3

/** 426 : client trop ancien. Bureau : lance la vérification de mise à jour. */
async function onUpgradeRequired() {
  const [{ default: toast }, { t }] = await Promise.all([import('react-hot-toast'), import('../i18n')])
  toast.error(t('conn.upgradeRequired'), { id: 'upgrade-required', duration: 10_000 })
  if (!isTauri) return
  const { invoke } = await import('@tauri-apps/api/core')
  const info = await invoke<import('../components/DesktopUpdateToast').DesktopUpdateInfo | null>('update_check').catch(() => null)
  if (info) (await import('../components/DesktopUpdateToast')).showDesktopUpdateToast(info)
}

// Semaphore: une seule tentative de refresh à la fois, les autres attendent
let refreshPromise: Promise<void> | null = null


// Pages lisibles sans compte : un 401 n'y renvoie jamais vers /login (site public, pages légales).
const PUBLIC_PATHS = new Set(['/', '/login', '/register', '/verify-email', '/forgot-password', '/reset-password',
  '/fonctionnalites', '/telecharger', '/nouveautes', '/aide', '/a-propos', '/mentions-legales', '/confidentialite', '/cgu'])
export const isPublicPath = (p: string) => PUBLIC_PATHS.has(p) || p.startsWith('/telecharger/')

api.interceptors.response.use(
  r => {
    if (useServerStatus.getState().unavailable) useServerStatus.setState({ unavailable: false })
    return r
  },
  async err => {
    const url: string = err.config?.url ?? ''
    const status = err.response?.status
    // Le serveur a refusé avant de traiter : rejouer est sans effet de bord. Jetons et clé intacts.
    if (status === 503 && err.config) {
      useServerStatus.setState({ unavailable: true })
      const n = (err.config._tries503 ?? 0) + 1
      if (n > MAX_503_RETRIES) return Promise.reject(err)
      err.config._tries503 = n
      await new Promise(r => setTimeout(r, 1000 * 2 ** (n - 1)))
      return api(err.config)
    }
    if (status === 426) void onUpgradeRequired()
    const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/register') || url.includes('/auth/refresh')
    // Page publique : pas de rafraîchissement, sauf si la requête portait un jeton (bureau, lancement
    // sur « / ») : un jeton d'accès simplement périmé ne doit pas effacer la session du trousseau.
    const onPublicPage = typeof window !== 'undefined' && isPublicPath(window.location.pathname)
      && !err.config?.headers?.Authorization

    // Garde anti-boucle : si la requête déjà rejouée après un refresh échoue ENCORE en
    // 401 (bug serveur qui rejette un token pourtant valide, edge case), ne pas
    // redéclencher un refresh indéfiniment — laisser l'échec remonter. Sans ce flag,
    // chaque retry qui échoue relance un nouveau cycle refresh+retry pour toujours.
    if (err.response?.status === 401 && !isAuthEndpoint && !onPublicPage && !err.config?._retried) {
      try {
        if (!refreshPromise) {
          refreshPromise = (async () => {
            // Bureau : Rust rafraîchit avec le jeton du trousseau. Web : cookie HttpOnly.
            if (isTauri) await refreshAccess()
            else await axios.post(`${baseURL}/auth/refresh`, {}, { withCredentials: true, timeout: 15_000, headers: { 'X-ForgeChat-Tokens': 'cookie' } })
          })().finally(() => { refreshPromise = null })
        }
        await refreshPromise
        // Mettre à jour le header si Tauri
        if (isTauri) {
          const token = accessToken()
          if (token) err.config.headers.Authorization = `Bearer ${token}`
        }
        err.config._retried = true
        return api(err.config)
      } catch (refreshErr: any) {
        // Seul un refus explicite du serveur (jeton périmé, révoqué, compte suspendu) met fin à la session.
        // Réseau coupé, serveur qui redémarre, délai dépassé : on garde les jetons et on laisse l'erreur
        // remonter, sinon une micro-coupure au lancement obligeait à retaper e-mail et mot de passe.
        const status = refreshErr?.response?.status
        if (!(status === 400 || status === 401 || status === 403)) {
          err.sessionKept = true // lu par fetchMe : ce 401 d'origine n'est pas un refus définitif
          return Promise.reject(err)
        }
        if (isTauri) await clearLocalSession()
        // Relu ici (et non avant le refresh) : AuthGuard a pu entre-temps aller sur
        // /login?redirect=… ; un rechargement vers /login nu perdait la destination
        const { pathname, search } = window.location
        if (!isPublicPath(pathname)) window.location.href = `/login?redirect=${encodeURIComponent(pathname + search)}`
      }
    }
    return Promise.reject(err)
  }
)

// Mode hors ligne : lectures resservies, messages chiffrés mis en file (lib/offline).
installOffline(api)

export default api
