// Sondages chiffrés dans les MP et les groupes (audit 2026-10-12, amélioration n° 35). La question
// et les options voyagent dans le corps CHIFFRÉ du message (`poll`) ; les votes passent par les
// réactions 1️⃣…🔟 sur ce message : le serveur voit « option n° 2 », jamais ce qu'elle veut dire.
// Testé par scripts/encPoll.test.mjs.

export const KEYCAPS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'] as const

export interface EncPoll { q: string; o: string[]; m: boolean }

/** Sondage lu d'un corps de message, validé (null sinon). */
export function pollOf(body: unknown): EncPoll | null {
  const p = (body as { poll?: unknown } | null)?.poll as Partial<EncPoll> | undefined
  if (!p || typeof p.q !== 'string' || !p.q.trim() || p.q.length > 300 || !Array.isArray(p.o)) return null
  const o = p.o.filter((x): x is string => typeof x === 'string' && !!x.trim()).map(x => x.slice(0, 100))
  if (o.length < 2 || o.length > KEYCAPS.length || o.length !== p.o.length) return null
  return { q: p.q, o, m: p.m === true }
}

/** Corps à sceller depuis le formulaire (options = une par ligne). */
export function buildPoll(q: string, optionsText: string, multi: boolean): EncPoll | null {
  return pollOf({ poll: { q: q.trim(), o: optionsText.split('\n').map(s => s.trim()).filter(Boolean), m: multi } })
}

export interface Reaction { emoji: string; count: number; me?: boolean }

/** Voix par option et mes choix, depuis les réactions du message. */
export function tally(poll: EncPoll, reactions: readonly Reaction[] | null | undefined): { counts: number[]; mine: boolean[]; total: number } {
  const counts = poll.o.map((_, i) => reactions?.find(r => r.emoji === KEYCAPS[i])?.count ?? 0)
  const mine = poll.o.map((_, i) => !!reactions?.find(r => r.emoji === KEYCAPS[i])?.me)
  return { counts, mine, total: counts.reduce((a, b) => a + b, 0) }
}

/** Réactions à basculer pour voter `i` (choix unique : retire d'abord l'ancien vote). */
export function voteToggles(poll: EncPoll, mine: readonly boolean[], i: number): string[] {
  if (poll.m || mine[i]) return [KEYCAPS[i]]
  return [...mine.flatMap((on, k) => (on ? [KEYCAPS[k]] : [])), KEYCAPS[i]]
}
