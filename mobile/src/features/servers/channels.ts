import type { Category, Channel } from '@/types/models'

/** Salons qui s'ouvrent en conversation écrite (les autres types ont leur propre écran). */
export const isTextChannel = (c: Channel) => c.type === 'text' || c.type === 'announcement'

/** Sections de la liste : salons sans catégorie d'abord, puis chaque catégorie dans l'ordre. */
export function channelSections(channels: Channel[], categories: Category[]) {
  const list = channels.filter((c) => !c.hidden && !c.archived)
  const cats = [...categories].sort((a, b) => a.position - b.position)
  const byCat = new Map<string | null, Channel[]>()
  for (const c of list) {
    const key = c.category_id && cats.some((k) => k.id === c.category_id) ? c.category_id : null
    byCat.set(key, [...(byCat.get(key) ?? []), c])
  }
  const sort = (arr: Channel[]) => [...arr].sort((a, b) => a.position - b.position)
  const out: { category: Category | null; title: string | null; data: Channel[] }[] = []
  if (byCat.get(null)?.length) out.push({ category: null, title: null, data: sort(byCat.get(null)!) })
  for (const k of cats) out.push({ category: k, title: k.name, data: sort(byCat.get(k.id) ?? []) })
  return out
}

/** Salon à ouvrir en entrant dans un serveur : le dernier consulté s'il est encore lisible, sinon le premier salon texte. */
export function pickChannel(channels: Channel[], categories: Category[], lastId: string | undefined): Channel | null {
  const ordered = channelSections(channels, categories).flatMap((s) => s.data).filter(isTextChannel)
  return ordered.find((c) => c.id === lastId) ?? ordered[0] ?? null
}

/** Garde au plus `max` serveurs (les plus récents) : la persistance chiffrée limite la taille (~2 Ko). */
export function rememberChannel(map: Record<string, string>, serverId: string, channelId: string, max = 20): Record<string, string> {
  const next = { ...map }
  delete next[serverId]
  next[serverId] = channelId // ordre d'insertion = du plus ancien au plus récent
  const keys = Object.keys(next)
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) delete next[k]
  return next
}
