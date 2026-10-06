import type { ZodType } from 'zod'
import { APP_VERSION, apiBase } from '@/config/env'
import { logger } from './logger'
import { tokens } from './tokens'
import { xhrFetch } from './xhrFetch'

/**
 * Client HTTP de l'app.
 *
 * Sécurité :
 * - `credentials: 'omit'` : on n'utilise JAMAIS les cookies. Le serveur donne la
 *   priorité au cookie sur le header Bearer ; un cookie résiduel d'un autre
 *   compte pourrait sinon « gagner ». Le mobile s'authentifie uniquement en Bearer.
 * - Les segments de chemin sont encodés via `path\`\`` (anti path-injection).
 * - Refresh « single-flight » : une seule rotation de refresh token à la fois,
 *   les requêtes concurrentes attendent le même résultat (le serveur invalide
 *   l'ancien token à chaque rotation — deux refresh parallèles déconnecteraient).
 * - Timeout systématique.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly retryAfter?: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
  get isNetwork() {
    return this.status === 0
  }
}

export class SessionExpiredError extends ApiError {
  constructor() {
    super(401, 'Session expirée, reconnecte-toi.', 'session_expired')
    this.name = 'SessionExpiredError'
  }
}

type Listener = () => void
const sessionExpiredListeners = new Set<Listener>()
/** Notifié quand le refresh échoue définitivement (token révoqué/expiré). */
export function onSessionExpired(fn: Listener): () => void {
  sessionExpiredListeners.add(fn)
  return () => sessionExpiredListeners.delete(fn)
}

/**
 * Construit un chemin d'API en encodant chaque paramètre interpolé.
 *   path`/servers/${id}/channels` → "/servers/<encodé>/channels"
 */
export function path(strings: TemplateStringsArray, ...params: (string | number)[]): string {
  let out = strings[0] ?? ''
  params.forEach((p, i) => {
    const s = String(p)
    if (s.length === 0 || s === '.' || s === '..') throw new Error('Paramètre de chemin invalide')
    out += encodeURIComponent(s) + (strings[i + 1] ?? '')
  })
  return out
}

type Query = Record<string, string | number | boolean | null | undefined>

function buildUrl(p: string, query?: Query): string {
  if (!p.startsWith('/')) throw new Error('Le chemin doit commencer par /')
  let url = apiBase() + p
  if (query) {
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&')
    if (qs) url += `?${qs}`
  }
  return url
}

const DEFAULT_TIMEOUT = 20_000
const CLIENT_HEADER = `forgechat-mobile/${APP_VERSION}`

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const external = init.signal
  const onAbort = () => controller.abort()
  external?.addEventListener('abort', onAbort)
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    // Multipart : XMLHttpRequest (voir lib/xhrFetch), le fetch d'Expo refusant les fichiers { uri }.
    if (init.body instanceof FormData) {
      return await xhrFetch(url, {
        method: init.method ?? 'POST',
        headers: init.headers as Record<string, string>,
        body: init.body,
        signal: controller.signal,
      })
    }
    return await fetch(url, { ...init, signal: controller.signal, credentials: 'omit' })
  } catch (e) {
    if (external?.aborted) throw e
    throw new ApiError(0, controller.signal.aborted ? 'Délai dépassé' : 'Réseau indisponible', 'network')
  } finally {
    clearTimeout(timer)
    external?.removeEventListener('abort', onAbort)
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let message = `Erreur ${res.status}`
  let code: string | undefined
  let retryAfter: number | undefined
  try {
    const data = (await res.json()) as { error?: unknown; retry_after?: unknown }
    if (typeof data.error === 'string') {
      message = data.error
      if (data.error === 'totp_required') code = 'totp_required'
    }
    if (typeof data.retry_after === 'number') retryAfter = data.retry_after
  } catch {
    /* corps non-JSON : garder le message générique */
  }
  if (res.status === 429 && !code) code = 'rate_limited'
  return new ApiError(res.status, message, code, retryAfter)
}

// ─── Refresh single-flight ────────────────────────────────────────────────────

let refreshInFlight: Promise<string> | null = null

export function refreshAccessToken(): Promise<string> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

async function doRefresh(): Promise<string> {
  const refresh = await tokens.getRefreshToken()
  if (!refresh) throw new SessionExpiredError()

  const res = await fetchWithTimeout(
    buildUrl('/auth/refresh'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Client': CLIENT_HEADER },
      body: JSON.stringify({ refresh_token: refresh }),
    },
    DEFAULT_TIMEOUT,
  )

  if (res.status === 401 || res.status === 400 || res.status === 403) {
    // Refresh révoqué/expiré/déjà consommé : la session est terminée.
    await tokens.clear()
    sessionExpiredListeners.forEach((l) => l())
    throw new SessionExpiredError()
  }
  if (!res.ok) throw await parseError(res) // 5xx/429 : on garde le refresh token, on réessaiera

  const data = (await res.json()) as { access_token?: unknown; refresh_token?: unknown }
  if (typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string') {
    throw new ApiError(500, 'Réponse de refresh invalide')
  }
  // Persister le NOUVEAU refresh AVANT d'exposer l'access token : l'ancien est déjà invalide.
  await tokens.setRefreshToken(data.refresh_token)
  tokens.setAccessToken(data.access_token)
  logger.debug('http', 'access token renouvelé')
  return data.access_token
}

/** Garantit un access token valide (refresh proactif si expiration < 60 s). */
export async function ensureAccessToken(): Promise<string> {
  const current = tokens.getAccessToken()
  if (current && !tokens.accessTokenExpiresSoon(60)) return current
  return refreshAccessToken()
}

// ─── Requêtes ─────────────────────────────────────────────────────────────────

export interface RequestOptions<T> {
  body?: unknown
  query?: Query
  auth?: boolean
  signal?: AbortSignal
  timeoutMs?: number
  /** Validation runtime optionnelle de la réponse. */
  schema?: ZodType<T>
  /** Corps multipart (uploads). */
  formData?: FormData
}

async function send<T>(method: string, p: string, opts: RequestOptions<T>, retried = false): Promise<T> {
  const auth = opts.auth ?? true
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Client': CLIENT_HEADER }
  if (auth) headers.Authorization = `Bearer ${await ensureAccessToken()}`

  let body: BodyInit | undefined
  if (opts.formData) {
    body = opts.formData // Content-Type multipart posé automatiquement (boundary)
  } else if (opts.body !== undefined || method === 'POST' || method === 'PUT' || method === 'PATCH') {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body ?? {})
  }

  const res = await fetchWithTimeout(
    buildUrl(p, opts.query),
    { method, headers, body, signal: opts.signal },
    opts.timeoutMs ?? (opts.formData ? 120_000 : DEFAULT_TIMEOUT),
  )

  if (res.status === 401 && auth && !retried) {
    // Token révoqué côté serveur (blocklist, changement de mot de passe…) : un refresh, puis un seul retry.
    tokens.setAccessToken(null)
    await refreshAccessToken()
    return send(method, p, opts, true)
  }
  if (!res.ok) throw await parseError(res)
  if (res.status === 204) return undefined as T

  const text = await res.text()
  if (!text) return undefined as T
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return text as unknown as T
  }
  if (opts.schema) {
    const parsed = opts.schema.safeParse(json)
    if (!parsed.success) {
      logger.warn('http', `réponse inattendue ${method} ${p}`, parsed.error.issues.slice(0, 3))
      throw new ApiError(500, 'Réponse serveur inattendue', 'bad_response')
    }
    return parsed.data
  }
  return json as T
}

export const http = {
  get: <T>(p: string, o: RequestOptions<T> = {}) => send<T>('GET', p, o),
  post: <T>(p: string, body?: unknown, o: RequestOptions<T> = {}) => send<T>('POST', p, { ...o, body }),
  put: <T>(p: string, body?: unknown, o: RequestOptions<T> = {}) => send<T>('PUT', p, { ...o, body }),
  patch: <T>(p: string, body?: unknown, o: RequestOptions<T> = {}) => send<T>('PATCH', p, { ...o, body }),
  delete: <T>(p: string, o: RequestOptions<T> = {}) => send<T>('DELETE', p, o),
  upload: <T>(p: string, formData: FormData, o: RequestOptions<T> = {}) => send<T>('POST', p, { ...o, formData }),
}

/** Message d'erreur lisible pour l'UI. */
export function errorMessage(e: unknown, fallback = 'Une erreur est survenue'): string {
  if (e instanceof ApiError) {
    if (e.code === 'rate_limited' && e.retryAfter) return `Doucement ! Réessaie dans ${e.retryAfter} s.`
    if (e.status === 403 && e.message === 'Accès interdit') return "Tu n'as pas la permission de faire ça."
    return e.message
  }
  if (e instanceof Error && e.message) return e.message
  return fallback
}
