import type { Server } from '@/types/models'

/** Disposition de la barre des serveurs, partagée avec le web (GET /users/me/server-layout). */
export interface ServerLayout {
  order?: unknown
  folders?: unknown
  /** Entrées fixes (ordre) et masquées : voir railFixed.ts. */
  fixed?: unknown
  hidden?: unknown
  /** Clés ajoutées par d'autres clients : conservées à l'écriture. */
  [key: string]: unknown
}

export type RailEntry =
  | { kind: 'server'; server: Server }
  | { kind: 'folder'; id: string; name: string; color: string; servers: Server[] }

const COLOR = /^#[0-9a-f]{6}$/i

/**
 * Même rendu que le web (client/src/components/layout/railLayout.ts) : serveurs hors dossier et dossiers
 * non vides mêlés dans l'ordre choisi (`order` contient aussi les ids `folder_…`), nouveaux à la fin.
 * Une disposition absente ou abîmée donne la liste telle quelle.
 */
export function railEntries(servers: Server[], layout: ServerLayout | null | undefined): RailEntry[] {
  const byId = new Map(servers.map((s) => [s.id, s]))
  const folders: RailEntry[] = []
  const inFolder = new Set<string>()
  const raw = layout?.folders
  if (raw && typeof raw === 'object') {
    for (const [id, f] of Object.entries(raw as Record<string, unknown>)) {
      if (!f || typeof f !== 'object') continue
      const { name, color, serverIds } = f as { name?: unknown; color?: unknown; serverIds?: unknown }
      if (!Array.isArray(serverIds)) continue
      const list = serverIds.map((sid) => (typeof sid === 'string' ? byId.get(sid) : undefined)).filter((s): s is Server => !!s)
      list.forEach((s) => inFolder.add(s.id))
      if (list.length) {
        folders.push({
          kind: 'folder',
          id,
          name: typeof name === 'string' && name.trim() ? name.slice(0, 64) : 'Dossier',
          color: typeof color === 'string' && COLOR.test(color) ? color : '#5865F2',
          servers: list,
        })
      }
    }
  }
  const order = Array.isArray(layout?.order) ? (layout.order as unknown[]).filter((x): x is string => typeof x === 'string') : []
  const rank = (id: string) => {
    const i = order.indexOf(id)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  const entries: RailEntry[] = [...servers.filter((s) => !inFolder.has(s.id)).map((server) => ({ kind: 'server' as const, server })), ...folders]
  const key = (e: RailEntry) => (e.kind === 'server' ? e.server.id : e.id)
  return entries.map((e, i) => [e, i] as const).sort((a, b) => rank(key(a[0])) - rank(key(b[0])) || a[1] - b[1]).map(([e]) => e)
}
