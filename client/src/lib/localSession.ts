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

/** Efface la session locale (déconnexion) en gardant les autres comptes mis de côté. */
export async function clearLocalSession() {
  access = null
  const alt = localStorage.getItem(TAURI_KEY)
  localStorage.clear()
  if (alt) localStorage.setItem(TAURI_KEY, alt)
  await invokeSession('session_clear').catch(e => console.warn('[session] trousseau', e))
}

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
