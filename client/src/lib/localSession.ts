// Bureau (Tauri) : le jeton de rafraîchissement vit dans le trousseau de l'OS, côté Rust
// (desktop/src-tauri/src/session.rs), et ne passe jamais par ici. Le jeton d'accès reste en
// mémoire seulement. Module sans dépendance statique (importé par le client HTTP).

/** Comptes mis de côté sur le bureau (lib/accounts.ts) : profils seulement, sans jeton. */
export const TAURI_KEY = 'fc_alt_accounts'

let access: string | null = null

export const invokeSession = async <T>(cmd: string, args?: Record<string, unknown>) =>
  (await import('@tauri-apps/api/core')).invoke<T>(cmd, args)

/** Jeton d'accès courant (mémoire). */
export const accessToken = () => access
export const setAccessToken = (t: string | null) => { access = t }

/** Après une connexion : accès en mémoire, rafraîchissement au trousseau. */
export async function storeSession(accessTok: string, refreshTok: string) {
  access = accessTok
  await invokeSession('session_store', { access: accessTok, refresh: refreshTok })
}

/** Reprend le jeton d'accès gardé par Rust (rechargement de la page). */
export async function loadAccess(): Promise<string | null> {
  access = access ?? await invokeSession<string | null>('session_access')
  return access
}

/** Rafraîchit via Rust. Rejet au format d'axios : `response` absent = réseau. */
export async function refreshAccess(): Promise<string> {
  try {
    access = await invokeSession<string>('session_refresh')
    return access
  } catch (status) {
    const s = typeof status === 'number' && status > 0 ? status : 0
    throw Object.assign(new Error(`refresh ${s || 'network'}`), { response: s ? { status: s } : undefined })
  }
}

const pause = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Lancement : jeton d'accès en mémoire, sinon rafraîchi par Rust depuis le trousseau. Rend false
 * sans jeton. Refus (400/401/403) : Rust a déjà oublié le jeton. Panne passagère (réseau, 5xx) :
 * réessayée, puis abandonnée sans toucher au trousseau (reprise au lancement ou au retour du réseau).
 */
export async function resumeSession(wait = pause): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    if (await loadAccess()) return true
    try {
      await refreshAccess()
      return true
    } catch (e) {
      const s = (e as { response?: { status: number } }).response?.status
      if (s === 400 || s === 401 || s === 403 || attempt >= 3) return false
    }
    await wait(1500 * (attempt + 1))
  }
}

/** Ce qui appartient à la session (jetons d'anciennes versions, brouillons de messages). */
const SESSION_KEYS = ['access_token', 'refresh_token', 'fc-drafts']

/**
 * Efface la session locale. Les préférences de l'appareil (micro, caméra, zoom, thème, dernier
 * e-mail…) et les comptes mis de côté restent : effacer tout le stockage faisait retaper l'adresse
 * et reperdre ses réglages à chaque session expirée (2026-10-12).
 * `forgetLogin` : déconnexion volontaire, l'identifiant mémorisé (« Se souvenir de moi ») est oublié.
 */
export async function clearLocalSession(forgetLogin = false) {
  access = null
  for (const k of SESSION_KEYS) { try { localStorage.removeItem(k) } catch { /* stockage indisponible */ } }
  await invokeSession('session_clear').catch(e => console.warn('[session] trousseau', e))
  if (forgetLogin) await invokeSession('login_forget').catch(e => console.warn('[session] identifiants', e))
}

// ─── « Se souvenir de moi » (bureau) ─────────────────────────────────────────────
export interface RememberedLogin { email: string; password: string }

/** Range e-mail et mot de passe au trousseau de l'OS (côté Rust, jamais dans la page). */
export const rememberLoginOnDevice = (email: string, password: string) =>
  invokeSession('login_remember', { email, password }).catch(e => console.warn('[session] identifiants', e))

export const rememberedLogin = () => invokeSession<RememberedLogin | null>('login_remembered').catch(() => null)

export const forgetRememberedLogin = () => invokeSession('login_forget').catch(() => {})

/** Où la session est gardée : `os`, `file` (repli chiffré Linux) ou `memory`. */
export const sessionStorageStatus = () => invokeSession<string>('session_storage_status').catch(() => 'memory')

/**
 * Anciennes versions : jetons en clair dans localStorage. Rangés une fois au trousseau, puis
 * effacés quoi qu'il arrive (au pire, une reconnexion).
 */
export async function migrateLegacySession() {
  const refresh = localStorage.getItem('refresh_token')
  const raw = localStorage.getItem(TAURI_KEY)
  if (!refresh && !localStorage.getItem('access_token') && !raw?.includes('refresh_token')) return
  let alts: Record<string, unknown>[] = []
  try { const v: unknown = JSON.parse(raw ?? '[]'); if (Array.isArray(v)) alts = v.filter(a => a && typeof a === 'object') } catch { /* illisible : abandonnée */ }
  const warn = (e: unknown) => console.warn('[session] migration', e)
  for (const a of alts) {
    if (typeof a.id === 'string' && typeof a.refresh_token === 'string') {
      await invokeSession('session_import_account', { id: a.id, refresh: a.refresh_token }).catch(warn)
    }
  }
  if (refresh) await invokeSession('session_store', { access: localStorage.getItem('access_token') ?? '', refresh }).catch(warn)
  localStorage.setItem(TAURI_KEY, JSON.stringify(alts.map(({ refresh_token: _r, ...profile }) => profile)))
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
}
