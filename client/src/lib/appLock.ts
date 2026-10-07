import { create } from 'zustand'

/**
 * Verrouillage de l'appli web/bureau par code local après inactivité.
 * Le code ne quitte jamais l'appareil : seule une empreinte PBKDF2-SHA256 salée
 * est gardée (stockage local du navigateur, par compte). C'est un écran de
 * confidentialité face à quelqu'un devant l'ordinateur, pas une protection
 * contre qui contrôle le navigateur (limite dite dans les Réglages).
 */

export const LOCK_DELAYS = [1, 5, 15, 30, 60] as const // minutes
export type LockDelay = (typeof LOCK_DELAYS)[number]

interface LockConfig { salt: string; hash: string; iter: number; delay: LockDelay }

const ITER = 210_000
const storageKey = (userId: string) => `fc_app_lock_${userId}`

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

async function derive(code: string, salt: Uint8Array, iter: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter }, key, 256)
  return b64(new Uint8Array(bits))
}

/** Code accepté : 4 à 32 caractères. */
export const validCode = (code: string) => code.length >= 4 && code.length <= 32

function readConfig(userId: string): LockConfig | null {
  try {
    const c = JSON.parse(localStorage.getItem(storageKey(userId)) ?? 'null') as LockConfig | null
    return c && typeof c.hash === 'string' && typeof c.salt === 'string' && LOCK_DELAYS.includes(c.delay) ? c : null
  } catch { return null }
}

/** Attente imposée après `fails` essais ratés (0 pour les 4 premiers, puis 30 s doublées, 15 min au plus). */
export const backoffMs = (fails: number) => (fails < 5 ? 0 : Math.min(30_000 * 2 ** (fails - 5), 15 * 60_000))

interface AppLockState {
  userId: string | null
  config: LockConfig | null
  locked: boolean
  fails: number
  retryAt: number
  /** Charge le réglage du compte connecté ; verrouille d'emblée s'il est actif (un F5 ne doit pas déverrouiller). */
  load: (userId: string | null) => void
  enable: (code: string, delay: LockDelay) => Promise<void>
  setDelay: (delay: LockDelay) => void
  disable: () => void
  lockNow: () => void
  unlock: (code: string) => Promise<boolean>
}

export const useAppLock = create<AppLockState>()((set, get) => {
  const save = (config: LockConfig | null) => {
    const { userId } = get()
    if (!userId) return
    try {
      if (config) localStorage.setItem(storageKey(userId), JSON.stringify(config))
      else localStorage.removeItem(storageKey(userId))
    } catch { /* stockage indisponible : réglage gardé pour la session */ }
    set({ config })
  }
  return {
    userId: null,
    config: null,
    locked: false,
    fails: 0,
    retryAt: 0,
    load: (userId) => {
      const config = userId ? readConfig(userId) : null
      set({ userId, config, locked: !!config, fails: 0, retryAt: 0 })
    },
    enable: async (code, delay) => {
      const salt = crypto.getRandomValues(new Uint8Array(16))
      save({ salt: b64(salt), hash: await derive(code, salt, ITER), iter: ITER, delay })
    },
    setDelay: (delay) => { const c = get().config; if (c) save({ ...c, delay }) },
    disable: () => { save(null); set({ locked: false }) },
    lockNow: () => { if (get().config) set({ locked: true }) },
    unlock: async (code) => {
      const { config, retryAt, fails } = get()
      if (!config) { set({ locked: false }); return true }
      if (Date.now() < retryAt) return false
      const ok = (await derive(code, unb64(config.salt), config.iter)) === config.hash
      if (ok) set({ locked: false, fails: 0, retryAt: 0 })
      else set({ fails: fails + 1, retryAt: Date.now() + backoffMs(fails + 1) })
      return ok
    },
  }
})

/** Surveille l'activité ; verrouille après le délai choisi. Renvoie la fonction d'arrêt. */
export function watchInactivity(): () => void {
  let last = Date.now()
  const touch = () => { last = Date.now() }
  const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'] as const
  events.forEach(e => window.addEventListener(e, touch, { passive: true }))
  const timer = setInterval(() => {
    const { config, locked, lockNow } = useAppLock.getState()
    if (config && !locked && Date.now() - last >= config.delay * 60_000) lockNow()
  }, 10_000)
  const onLock = () => useAppLock.getState().lockNow()
  window.addEventListener('forgechat:lock-now', onLock)
  return () => {
    events.forEach(e => window.removeEventListener(e, touch))
    clearInterval(timer)
    window.removeEventListener('forgechat:lock-now', onLock)
  }
}
