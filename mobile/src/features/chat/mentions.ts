/** Personne mentionnable dans la conversation courante (membre du serveur ou du groupe). */
export interface MentionCandidate {
  id: string
  username: string
  nickname?: string | null
  avatar: string | null
}

/**
 * Pseudo reconnu tel quel par le serveur (push::notify_mentions, reads::get_user_mentions)
 * et par lib/markdown : sinon on insère la forme <@uuid>, que le serveur reconnaît aussi.
 */
const PLAIN_NAME = /^[A-Za-z0-9_-]{2,32}$/
const QUERY_CHAR = /[\p{L}\p{N}_-]/u
export const MENTION_SUGGESTIONS_MAX = 8

/**
 * Mention en cours de saisie juste avant le curseur : « @ » en début de texte ou après
 * un espace, suivi de caractères de pseudo. Renvoie la position du « @ » et le texte tapé.
 */
export function activeMentionQuery(text: string, cursor: number): { start: number; query: string } | null {
  if (cursor < 1 || cursor > text.length) return null
  let i = cursor
  while (i > 0 && QUERY_CHAR.test(text[i - 1]!)) i--
  if (i < 1 || text[i - 1] !== '@') return null
  const at = i - 1
  if (at > 0 && !/\s/.test(text[at - 1]!)) return null // e-mail, « a@b »…
  const query = text.slice(i, cursor)
  return query.length <= 32 ? { start: at, query } : null
}

/** Suggestions : moi exclu ; d'abord les pseudos/surnoms qui commencent par la saisie, puis ceux qui la contiennent. */
export function filterMentionCandidates(
  candidates: readonly MentionCandidate[],
  query: string,
  myId: string | null,
  limit = MENTION_SUGGESTIONS_MAX,
): MentionCandidate[] {
  const q = query.toLocaleLowerCase()
  const seen = new Set<string>()
  const starts: MentionCandidate[] = []
  const contains: MentionCandidate[] = []
  for (const c of candidates) {
    if (c.id === myId || seen.has(c.id)) continue
    seen.add(c.id)
    const names = [c.username, c.nickname ?? ''].map((n) => n.toLocaleLowerCase())
    if (names.some((n) => n.startsWith(q))) starts.push(c)
    else if (q && names.some((n) => n.includes(q))) contains.push(c)
  }
  const byName = (a: MentionCandidate, b: MentionCandidate) => a.username.localeCompare(b.username)
  return [...starts.sort(byName), ...contains.sort(byName)].slice(0, limit)
}

export function mentionToken(c: Pick<MentionCandidate, 'id' | 'username'>): string {
  return PLAIN_NAME.test(c.username) ? `@${c.username}` : `<@${c.id}>`
}

/** Remplace « @saisie » (de start au curseur) par la mention suivie d'un espace. */
export function applyMention(
  text: string,
  start: number,
  cursor: number,
  c: Pick<MentionCandidate, 'id' | 'username'>,
): { text: string; cursor: number } {
  const token = `${mentionToken(c)} `
  const after = text.slice(cursor).replace(/^ /, '')
  return { text: text.slice(0, start) + token + after, cursor: start + token.length }
}
