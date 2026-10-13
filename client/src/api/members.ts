import api from './client'

/** Taille de page maximale de GET /servers/:id/members (server/src/handlers/servers.rs). */
export const MEMBERS_PAGE = 1000

/**
 * Tous les membres d'un serveur. Le serveur pagine par curseur (`after` = dernier pseudo,
 * ordre alphabétique, 1000 au plus) : sans boucle, un serveur de plus de 1000 membres
 * serait tronqué. ponytail: charge toutes les pages d'un coup ; chargement à la demande
 * le jour où la liste des membres sera virtualisée (audit C20).
 */
export async function fetchAllMembers<T = unknown>(serverId: string): Promise<T[]> {
  const all: T[] = []
  let after: string | undefined
  for (;;) {
    const { data } = await api.get<Array<T & { username: string }>>(`/servers/${serverId}/members`, { params: { limit: MEMBERS_PAGE, ...(after ? { after } : {}) } })
    all.push(...data)
    if (data.length < MEMBERS_PAGE) return all
    after = data[data.length - 1].username
  }
}
