import { create } from 'zustand'
import { usersApi } from '@/api/users'
import { logger } from '@/lib/logger'
import type { NameInfo } from '@/lib/nameStyle'

/**
 * Cache des pseudos stylés (GET /users/styles). Les ids demandés pendant ~50 ms partent en une
 * requête (100 max) ; un id connu ou en cours n'est jamais redemandé. USER_UPDATE le tient à jour.
 */
interface NameStylesState {
  /** null = utilisateur inconnu du serveur (pas redemandé). */
  byId: Record<string, NameInfo | null>
  put: (entries: ({ id: string } & NameInfo)[]) => void
}

export const useNameStyles = create<NameStylesState>((set) => ({
  byId: {},
  put: (entries) =>
    set((s) => {
      const byId = { ...s.byId }
      for (const { id, username, display_name, name_style, profile_tag } of entries) byId[id] = { username, display_name, name_style, profile_tag }
      return { byId }
    }),
}))

const BATCH_MS = 50
const MAX_IDS = 100
const pending = new Set<string>()
const inflight = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null

async function flush() {
  timer = null
  const ids = [...pending]
  pending.clear()
  for (let i = 0; i < ids.length; i += MAX_IDS) {
    const chunk = ids.slice(i, i + MAX_IDS)
    chunk.forEach((id) => inflight.add(id))
    try {
      const list = await usersApi.styles(chunk)
      const found = Array.isArray(list) ? list : []
      useNameStyles.getState().put(found)
      // Absents de la réponse : marqués inconnus pour ne pas les redemander en boucle.
      const missing = chunk.filter((id) => !found.some((u) => u.id === id))
      if (missing.length) useNameStyles.setState((s) => ({ byId: { ...s.byId, ...Object.fromEntries(missing.map((id) => [id, null])) } }))
    } catch (e) {
      // Réseau : on oublie la demande, elle sera refaite au prochain affichage.
      logger.warn('nameStyles', 'chargement impossible', e)
    } finally {
      chunk.forEach((id) => inflight.delete(id))
    }
  }
}

/** Demande le style de `id` (regroupé, sans doublon). */
export function requestNameStyle(id: string | undefined) {
  if (!id || id in useNameStyles.getState().byId || inflight.has(id) || pending.has(id)) return
  pending.add(id)
  timer ??= setTimeout(() => void flush(), BATCH_MS)
}

/** Champs de style d'un objet utilisateur reçu (USER_UPDATE, /users/me) ; ignoré s'il ne les porte pas. */
export function rememberUserStyle(user: unknown) {
  if (!user || typeof user !== 'object') return
  const u = user as Partial<NameInfo> & { id?: unknown }
  if (typeof u.id !== 'string' || typeof u.username !== 'string' || !('display_name' in u || 'name_style' in u)) return
  useNameStyles.getState().put([{ id: u.id, username: u.username, display_name: u.display_name ?? null, name_style: u.name_style ?? null, profile_tag: u.profile_tag ?? null }])
}
