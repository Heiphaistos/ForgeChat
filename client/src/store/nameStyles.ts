import { useEffect } from 'react'
import { create } from 'zustand'
import api from '../api/client'
import { cleanStyle, type NameStyle } from '../lib/nameStyle'

/** Habillage public d'un utilisateur : nom d'affichage, style du pseudo, étiquette. */
export interface UserLook {
  /** Pour reconnaître un nom étranger (webhook, message importé) posté sous cet id. */
  username?: string
  display_name: string | null
  name_style: NameStyle | null
  profile_tag: string | null
}

interface LookState {
  looks: Record<string, UserLook | null>
  /** Depuis /users/styles, un USER_UPDATE ou toute fiche utilisateur. */
  set: (id: string, user: object) => void
}

/**
 * Cache des habillages, rempli en lot par GET /users/styles (100 ids max par appel) et
 * tenu à jour par USER_UPDATE. Évite d'ajouter ces champs à chaque requête de messages,
 * membres, MP et vocal : tout composant qui connaît un `userId` peut afficher le pseudo stylé.
 */
export const useNameStyles = create<LookState>(set => ({
  looks: {},
  set: (id, user) => {
    const u = user as Record<string, unknown>
    const look: UserLook = {
      username: typeof u.username === 'string' ? u.username : undefined,
      display_name: typeof u.display_name === 'string' ? u.display_name : null,
      name_style: cleanStyle(u.name_style),
      profile_tag: typeof u.profile_tag === 'string' ? u.profile_tag : null,
    }
    set(s => ({ looks: { ...s.looks, [id]: look } }))
  },
}))

const pending = new Set<string>()
const requested = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function flush() {
  timer = null
  const ids = [...pending]
  pending.clear()
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    try {
      const { data } = await api.get<Array<UserLook & { id: string }>>('/users/styles', { params: { ids: chunk.join(',') } })
      const store = useNameStyles.getState()
      const found = new Set<string>()
      for (const u of Array.isArray(data) ? data : []) { store.set(u.id, u); found.add(u.id) }
      // Inconnus (compte supprimé, webhook) : mémorisés vides pour ne pas redemander.
      useNameStyles.setState(s => ({ looks: { ...s.looks, ...Object.fromEntries(chunk.filter(id => !found.has(id)).map(id => [id, null])) } }))
    } catch {
      // Réseau : on retentera au prochain affichage.
      chunk.forEach(id => requested.delete(id))
    }
  }
}

/** Demande l'habillage d'un utilisateur (regroupé avec les autres demandes pendant 40 ms). */
export function requestLook(id: string | null | undefined) {
  if (!id || requested.has(id) || !UUID.test(id)) return
  requested.add(id)
  pending.add(id)
  timer ??= setTimeout(() => void flush(), 40)
}

/** Habillage d'un utilisateur (null tant qu'inconnu ou sans personnalisation). */
export function useLook(id: string | null | undefined): UserLook | null {
  const look = useNameStyles(s => (id ? s.looks[id] : undefined))
  useEffect(() => { if (look === undefined) requestLook(id) }, [id, look])
  return look ?? null
}
