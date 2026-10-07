// Index local des messages déchiffrés, pour chercher dans les conversations chiffrées sans
// jamais envoyer le texte au serveur. Alimenté au déchiffrement (e2e/conversations.openRaw),
// gardé dans le dossier privé de l'appli (fichier JSON), vidé à la déconnexion et au
// changement de compte, purgé des messages supprimés ou échus (messages éphémères).
import { requireOptionalNativeModule } from 'expo'
import { useAccountKey } from './accountKey'
import { isEmptyQuery, matches, parseQuery, type IndexedMsg } from '@/features/search/localQuery'

/** Messages gardés au plus (les plus anciens sont oubliés au-delà). */
const MAX_ENTRIES = 10_000
const MAX_RESULTS = 200
const SAVE_MS = 5000
const FILE = 'forgechat-search-v1.json'

// Module natif FileSystem (expo-file-system, déjà lié dans l'appli par expo) : seule la partie utilisée.
interface NativeFile { readonly exists: boolean; text(): Promise<string>; write(content: string): void; create(o?: { overwrite?: boolean }): void; delete(): void }
interface FsModule { FileSystemFile: new (uri: string) => NativeFile; documentDirectory: string }
const fs = requireOptionalNativeModule<FsModule>('FileSystem')
const file = () => (fs ? new fs.FileSystemFile(`${fs.documentDirectory.replace(/\/?$/, '/')}${FILE}`) : null)

interface Stored { owner: string; msgs: IndexedMsg[] }

let entries: Map<string, IndexedMsg> | null = null
let owner: string | null = null
let loading: Promise<void> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
const convNames = new Map<string, { name: string; serverId?: string | null }>()

/** Compte de la clé chargée (pas le magasin de session : ce module est chargé par e2e/conversations). */
const me = () => useAccountKey.getState().userId ?? null

/** Charge l'index du compte courant (un index d'un autre compte est oublié). */
function load(): Promise<void> {
  const user = me()
  if (entries && owner === user) return Promise.resolve()
  loading ??= (async () => {
    entries = new Map()
    owner = user
    try {
      const f = file()
      if (!f?.exists || !user) return
      const data = JSON.parse(await f.text()) as Stored
      if (data?.owner === user && Array.isArray(data.msgs)) for (const m of data.msgs) if (m?.id) entries.set(m.id, m)
    } catch { /* fichier absent ou illisible : index reconstruit au fil des lectures */ }
  })().finally(() => { loading = null })
  return loading
}

function save() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      const f = file()
      if (!f || !entries || !owner) return
      if (entries.size > MAX_ENTRIES) {
        const oldest = [...entries.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, entries.size - MAX_ENTRIES)
        for (const m of oldest) entries.delete(m.id)
      }
      if (!f.exists) f.create({ overwrite: true })
      f.write(JSON.stringify({ owner, msgs: [...entries.values()] } satisfies Stored))
    } catch { /* stockage plein : l'index reste en mémoire pour la session */ }
  }, SAVE_MS)
}

/** Les écrans ouverts donnent le nom de leur conversation (filtre dans:). */
export function rememberConvName(convId: string, name: string | null | undefined, serverId?: string | null) {
  if (convId && name) convNames.set(convId, { name, serverId })
}

/** Ajoute (ou remplace, à l'édition) un message déchiffré. */
export function indexMessage(m: Omit<IndexedMsg, 'convName' | 'serverId'> & { serverId?: string | null }) {
  if (!m.id || !m.text.trim() || !me()) return
  const conv = convNames.get(m.convId)
  const entry: IndexedMsg = { ...m, convName: conv?.name ?? null, serverId: m.serverId ?? conv?.serverId ?? null }
  void load().then(() => {
    entries?.set(m.id, entry)
    save()
  })
}

/** Message supprimé ou échu : retiré de l'index. */
export function unindexMessage(id: string) {
  if (!id) return
  void load().then(() => {
    if (entries?.delete(id)) save()
  })
}

/** Recherche plein texte locale, du plus récent au plus ancien ; `convId` limite à une conversation. */
export async function searchLocal(input: string, convId?: string): Promise<IndexedMsg[]> {
  const q = parseQuery(input)
  if (isEmptyQuery(q) || !me()) return []
  await load()
  const now = Date.now()
  const out: IndexedMsg[] = []
  const sorted = [...(entries?.values() ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  for (const m of sorted) {
    if (out.length >= MAX_RESULTS) break
    if (convId && m.convId !== convId) continue
    const named = m.convName ? m : { ...m, convName: convNames.get(m.convId)?.name ?? null }
    if (matches(named, q, now)) out.push(named)
  }
  return out
}

export async function countIndexed(): Promise<number> {
  await load()
  return entries?.size ?? 0
}

/** Déconnexion, ou demande de l'utilisateur : plus aucun texte déchiffré sur l'appareil. */
export function clearSearchIndex() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  entries = null
  owner = null
  convNames.clear()
  try {
    const f = file()
    if (f?.exists) f.delete()
  } catch { /* rien à effacer */ }
}
