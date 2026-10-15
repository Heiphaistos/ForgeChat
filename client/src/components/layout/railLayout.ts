import { t as tr } from '../../i18n'
// Rangement de la barre des serveurs (comme Discord), sans interface : ordre du premier niveau
// (serveurs hors dossier et dossiers mêlés) et dossiers. Synchronisé via /users/me/server-layout
// ({ order, folders }) ; `order` contient des ids de serveurs et de dossiers (`folder_…`).

export interface Folder { name: string; color: string; serverIds: string[] }
export type Folders = Record<string, Folder>
/** `fixed` : ordre des entrées fixes ; `hidden` : entrées fixes masquées. Absents chez les anciens clients. */
export interface RailLayout { order: string[]; folders: Folders; fixed?: string[]; hidden?: string[] }
export interface Drag { kind: 'server' | 'folder'; id: string }
/** `inFolder` : serveur affiché dans un dossier ouvert. */
export interface Target { kind: 'server' | 'folder'; id: string; inFolder?: string }
export type Zone = 'before' | 'after' | 'into'

export const FOLDER_COLORS = ['#5865F2', '#57F287', '#FEE75C', '#EB459E', '#ED4245', '#FF7A00', '#00B8D9', '#A855F7']
export const isFolderId = (id: string) => id.startsWith('folder_')
export const newFolderId = () => `folder_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

/** Premier niveau affiché : serveurs hors dossier et dossiers non vides, dans l'ordre enregistré (nouveaux à la fin). */
export function topLevel(serverIds: readonly string[], l: RailLayout): string[] {
  const known = new Set(serverIds)
  const inFolder = new Set(Object.values(l.folders).flatMap(f => f.serverIds))
  const items = [
    ...serverIds.filter(id => !inFolder.has(id)),
    ...Object.keys(l.folders).filter(fid => l.folders[fid].serverIds.some(id => known.has(id))),
  ]
  const rank = (id: string) => { const i = l.order.indexOf(id); return i === -1 ? Number.MAX_SAFE_INTEGER : i }
  return items.map((id, i) => [id, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([id]) => id)
}

/** Zones acceptées par une cible : on ne range pas un dossier dans un dossier. */
export const acceptsInto = (drag: Drag, target: Target) => drag.kind === 'server' && !target.inFolder

/** Disposition après avoir lâché `drag` sur `target` (zone avant / après / dedans). */
export function applyDrop(serverIds: readonly string[], l: RailLayout, drag: Drag, target: Target, zone: Zone): RailLayout {
  if (drag.id === target.id) return l
  if (drag.kind === 'folder' && target.inFolder) return l
  const folders: Folders = Object.fromEntries(Object.entries(l.folders).map(([k, f]) => [k, { ...f, serverIds: [...f.serverIds] }]))
  let top = topLevel(serverIds, l).filter(id => id !== drag.id)
  if (drag.kind === 'server') for (const f of Object.values(folders)) f.serverIds = f.serverIds.filter(id => id !== drag.id)
  const effective: Zone = zone === 'into' && !acceptsInto(drag, target) ? 'after' : zone

  if (target.inFolder) {
    const f = folders[target.inFolder]
    if (!f) return l
    const i = f.serverIds.indexOf(target.id)
    f.serverIds.splice(i === -1 ? f.serverIds.length : effective === 'after' ? i + 1 : i, 0, drag.id)
  } else if (effective === 'into') {
    if (target.kind === 'folder' && folders[target.id]) folders[target.id].serverIds.push(drag.id)
    else {
      const fid = newFolderId()
      folders[fid] = { name: tr('sw.rail.newFolder'), color: FOLDER_COLORS[Object.keys(folders).length % FOLDER_COLORS.length], serverIds: [target.id, drag.id] }
      top = top.map(id => (id === target.id ? fid : id))
    }
  } else {
    const i = top.indexOf(target.id)
    top.splice(i === -1 ? top.length : effective === 'after' ? i + 1 : i, 0, drag.id)
  }

  for (const [k, f] of Object.entries(folders)) if (!f.serverIds.length) delete folders[k]
  return { ...l, order: top.filter(id => !isFolderId(id) || folders[id]), folders }
}

/** Dossier défait : ses serveurs reprennent sa place au premier niveau. */
export function dissolveFolder(serverIds: readonly string[], l: RailLayout, folderId: string): RailLayout {
  const f = l.folders[folderId]
  if (!f) return l
  const top = topLevel(serverIds, l).flatMap(id => (id === folderId ? f.serverIds : [id]))
  const folders = { ...l.folders }
  delete folders[folderId]
  return { ...l, order: top, folders }
}
