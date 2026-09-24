/**
 * Remontée automatique des erreurs vers `POST /api/diagnostics/report`.
 *
 * Importé EN PREMIER par main.tsx : les écouteurs sont posés avant l'évaluation
 * de l'application. Envoi par `fetch` direct (pas axios : pas d'intercepteur de
 * rafraîchissement, et l'envoi doit marcher même si l'app n'a jamais démarré).
 * Anti-rafale : une même erreur n'est envoyée qu'une fois par session, au plus
 * MAX_AUTO_REPORTS envois automatiques, regroupés toutes les 2 s.
 */
import { baseURL } from '../api/client'

type Kind = 'js_error' | 'unhandled_rejection' | 'react_crash' | 'manual'

interface Report {
  platform: string
  app_version: string
  kind: Kind
  message: string
  stack?: string
  log?: string
  user_agent: string
  url: string
}

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
const MAX_AUTO_REPORTS = 10
const FLUSH_DELAY_MS = 2_000

function detectPlatform(): string {
  if (!isTauri) return 'web'
  const s = `${navigator.userAgent} ${navigator.platform}`.toLowerCase()
  if (s.includes('win')) return 'windows'
  if (s.includes('mac')) return 'macos'
  if (s.includes('linux')) return 'linux'
  return 'other'
}

export const PLATFORM = detectPlatform()

/** Dernières erreurs vues (y compris le bruit), jointes à un signalement manuel. */
const recent: string[] = []
const seen = new Set<string>()
let autoSent = 0
let queue: Report[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

const NOISE = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i, // erreur d'un script d'une autre origine : rien d'exploitable
  /(chrome|moz|safari|safari-web)-extension:\/\//i,
  /Failed to fetch|NetworkError|Network Error|Load failed|ERR_NETWORK|ERR_INTERNET_DISCONNECTED/i,
  /timeout of \d+ms exceeded|ECONNABORTED|AbortError|CanceledError|canceled/i,
  /Request failed with status code 4\d\d/, // refus attendu (droits, session) : pas un bug
]

function isNoise(text: string): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  return NOISE.some(re => re.test(text))
}

function describe(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) return { message: `${err.name}: ${err.message}`, stack: err.stack }
  if (typeof err === 'string') return { message: err }
  try { return { message: JSON.stringify(err) ?? String(err) } } catch { return { message: String(err) } }
}

function currentUrl(): string {
  // Jamais de query string : elle porte parfois un jeton (réinitialisation, invitation).
  return typeof location === 'undefined' ? '' : location.origin + location.pathname
}

function build(kind: Kind, message: string, stack?: string, log?: string): Report {
  return {
    platform: PLATFORM,
    app_version: __APP_VERSION__,
    kind,
    message: message.slice(0, 2_000),
    stack: stack?.slice(0, 20_000),
    log,
    user_agent: navigator.userAgent,
    url: currentUrl(),
  }
}

async function send(report: Report): Promise<boolean> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (isTauri) {
    // App de bureau : les cookies ne traversent pas l'origine tauri.localhost.
    try {
      const token = localStorage.getItem('access_token')
      if (token) headers.Authorization = `Bearer ${token}`
    } catch { /* stockage indisponible : rapport anonyme */ }
  }
  const body = JSON.stringify(report)
  try {
    const res = await fetch(`${baseURL}/diagnostics/report`, {
      method: 'POST',
      headers,
      body,
      credentials: isTauri ? 'omit' : 'same-origin',
      // keepalive survit à la fermeture de l'onglet, mais est plafonné à 64 Ko.
      keepalive: body.length < 60_000,
    })
    return res.ok
  } catch {
    return false
  }
}

function flush() {
  flushTimer = null
  const batch = queue
  queue = []
  for (const r of batch) void send(r)
}

function capture(kind: Kind, err: unknown, extraStack?: string) {
  const { message, stack: ownStack } = describe(err)
  const stack = [ownStack, extraStack].filter(Boolean).join('\n--- composants ---\n') || undefined
  recent.push(`[${new Date().toISOString()}] ${kind}: ${message}${stack ? `\n${stack.slice(0, 1_500)}` : ''}`)
  if (recent.length > 20) recent.shift()
  if (isNoise(`${message}\n${stack ?? ''}`)) return
  const key = `${kind}|${message}|${(stack ?? '').slice(0, 300)}`
  if (seen.has(key) || autoSent >= MAX_AUTO_REPORTS) return
  seen.add(key)
  autoSent++
  queue.push(build(kind, message, stack))
  if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_DELAY_MS)
}

/** Appelé par ErrorBoundary (crash d'un composant React). */
export function reportReactCrash(error: Error, componentStack?: string) {
  capture('react_crash', error, componentStack)
}

/** Journal de l'app de bureau (Linux) ; `undefined` ailleurs ou en cas d'échec. */
async function readDesktopLog(): Promise<string | undefined> {
  if (!isTauri) return undefined
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const log = await invoke<string | null>('read_desktop_log')
    return log || undefined
  } catch {
    return undefined
  }
}

/** Bouton « Signaler un problème » : description + dernières erreurs + journal. */
export async function sendManualReport(description: string): Promise<boolean> {
  const log = await readDesktopLog()
  const errors = recent.length ? recent.join('\n\n') : undefined
  return send(build('manual', description.trim() || '(sans description)', errors, log))
}

function install() {
  if (typeof window === 'undefined') return
  window.addEventListener('error', e => {
    if (e.filename && isNoise(e.filename)) return
    capture('js_error', e.error ?? e.message ?? 'Erreur inconnue')
  })
  window.addEventListener('unhandledrejection', e => capture('unhandled_rejection', e.reason))
}

install()
