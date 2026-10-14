// Logique pure des fonctions « façon Discord » (catégories, non-lu, forum, comptes visibles).
// Sans React ni réseau : testée par scripts/discordFeatures.test.mjs.

export interface CategoryLike { id: string; name: string; position: number }
export interface CategoryPosition { id: string; position: number }

/** Déplace `id` d'un cran (`delta` = -1 monter, +1 descendre). `null` si rien ne bouge. */
export function moveId(ids: readonly string[], id: string, delta: -1 | 1): string[] | null {
  const from = ids.indexOf(id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= ids.length) return null
  const next = [...ids]
  next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}

/** CATEGORIES_REORDER : n'applique que les ids reçus (les catégories staff sont absentes
 *  pour les non-administrateurs), puis trie par position. */
export function applyCategoryPositions<T extends CategoryLike>(cats: readonly T[], positions: unknown): T[] {
  if (!Array.isArray(positions)) return [...cats]
  const pos = new Map<string, number>()
  for (const p of positions) {
    if (p && typeof p.id === 'string' && Number.isInteger(p.position)) pos.set(p.id, p.position)
  }
  return cats
    .map(c => (pos.has(c.id) ? { ...c, position: pos.get(c.id)! } : c))
    .sort((a, b) => a.position - b.position)
}

/** CATEGORY_UPDATE : fusionne le nom / la position reçus dans la catégorie connue. */
export function mergeCategory<T extends CategoryLike>(cats: readonly T[], patch: unknown): T[] {
  const p = patch as Partial<CategoryLike> | null
  if (!p || typeof p.id !== 'string') return [...cats]
  return cats
    .map(c => (c.id === p.id ? {
      ...c,
      ...(typeof p.name === 'string' ? { name: p.name } : {}),
      ...(Number.isInteger(p.position) ? { position: p.position } : {}),
    } : c))
    .sort((a, b) => a.position - b.position)
}

export interface UnreadPatch { channelId: string; serverId: string | null; count: number; mentionCount: number }

const count = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null)

/** READ_STATE_UPDATE `{unread: true}` (ou réponse de POST …/unread) validé ; `null` sinon. */
export function parseUnreadEvent(raw: unknown): UnreadPatch | null {
  const d = raw as Record<string, unknown> | null
  if (!d || d.unread !== true || typeof d.channel_id !== 'string' || !d.channel_id) return null
  const c = count(d.count)
  const m = count(d.mention_count)
  if (c === null || m === null) return null
  return { channelId: d.channel_id, serverId: typeof d.server_id === 'string' ? d.server_id : null, count: c, mentionCount: m }
}

export interface UnreadMaps {
  counts: Record<string, number>
  serverCounts: Record<string, number>
  mentionCounts: Record<string, number>
  serverMentionCounts: Record<string, number>
  channelServer: Record<string, string>
}

const setOrDrop = (m: Record<string, number>, k: string, v: number) => {
  const next = { ...m }
  if (v > 0) next[k] = v
  else delete next[k]
  return next
}

/** Pose les compteurs d'un salon tels quels et répercute l'écart sur le total du serveur. */
export function applyUnreadPatch(s: UnreadMaps, p: UnreadPatch): UnreadMaps {
  const sid = p.serverId ?? s.channelServer[p.channelId]
  const dc = p.count - (s.counts[p.channelId] ?? 0)
  const dm = p.mentionCount - (s.mentionCounts[p.channelId] ?? 0)
  return {
    counts: setOrDrop(s.counts, p.channelId, p.count),
    mentionCounts: setOrDrop(s.mentionCounts, p.channelId, p.mentionCount),
    serverCounts: sid ? setOrDrop(s.serverCounts, sid, (s.serverCounts[sid] ?? 0) + dc) : s.serverCounts,
    serverMentionCounts: sid ? setOrDrop(s.serverMentionCounts, sid, (s.serverMentionCounts[sid] ?? 0) + dm) : s.serverMentionCounts,
    channelServer: sid ? { ...s.channelServer, [p.channelId]: sid } : s.channelServer,
  }
}

/** Champs du forum envoyés à PATCH …/forum-settings : seulement ce qui a changé ; vide = `null`. */
export function forumSettingsPatch(
  before: { default_reaction_emoji?: string | null; post_guidelines?: string | null },
  after: { default_reaction_emoji: string; post_guidelines: string },
): { default_reaction_emoji?: string | null; post_guidelines?: string | null } {
  const norm = (v: string | null | undefined) => (v ?? '').replace(/\r\n?/g, '\n').trim() || null
  const out: { default_reaction_emoji?: string | null; post_guidelines?: string | null } = {}
  const emoji = norm(after.default_reaction_emoji)
  const rules = norm(after.post_guidelines)
  if (emoji !== norm(before.default_reaction_emoji)) out.default_reaction_emoji = emoji
  if (rules !== norm(before.post_guidelines)) out.post_guidelines = rules
  return out
}

export interface PublicAccount { platform: string; platform_username: string; platform_url: string | null }

/** Comptes connectés d'un profil (`GET /users/:id/profile`) : forme vérifiée, lien https seulement. */
export function publicAccounts(raw: unknown): PublicAccount[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(a => a && typeof a.platform === 'string' && typeof a.platform_username === 'string' && a.platform_username)
    .map(a => ({
      platform: a.platform as string,
      platform_username: a.platform_username as string,
      platform_url: typeof a.platform_url === 'string' && /^https:\/\/[^\s/]+/i.test(a.platform_url) ? a.platform_url : null,
    }))
}
