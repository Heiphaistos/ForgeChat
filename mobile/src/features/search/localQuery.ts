// Recherche plein texte dans l'index local des messages déchiffrés (règles pures,
// identiques à client/src/e2e/searchQuery.ts ; testées par
// __tests__/local-search.test.ts).

/** Message indexé sur l'appareil (jamais envoyé au serveur). */
export interface IndexedMsg {
  id: string
  kind: 'dm' | 'group' | 'channel'
  convId: string
  serverId?: string | null
  convName?: string | null
  authorId: string
  authorName: string
  text: string
  createdAt: string
  hasFile: boolean
  /** Message éphémère : retiré de l'index à l'échéance. */
  expiresAt?: string | null
}

export interface LocalQuery {
  terms: string[]
  from: string | null
  in: string | null
  hasFile: boolean
}

/** Minuscules sans accents : « Éte » trouve « été ». */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

const FILE_WORDS = new Set(['fichier', 'fichiers', 'file', 'files', 'piece-jointe', 'attachment'])
const FILTER = /^(de|from|dans|in|a|has|before|after|avant|apres):(.+)$/i

/** Filtres : de:/from: auteur, dans:/in: conversation, a:fichier/has:file ; le reste = mots cherchés (autres filtres ignorés). */
export function parseQuery(input: string): LocalQuery {
  const q: LocalQuery = { terms: [], from: null, in: null, hasFile: false }
  for (const tok of input.trim().split(/\s+/).filter(Boolean)) {
    const m = tok.match(FILTER)
    const key = m?.[1]?.toLowerCase()
    const val = m ? fold(m[2]!.replace(/^[@#]/, '')) : ''
    if (key === 'de' || key === 'from') q.from = val
    else if (key === 'dans' || key === 'in') q.in = val
    else if (key === 'a' || key === 'has') q.hasFile ||= FILE_WORDS.has(val)
    else if (!key) q.terms.push(fold(tok))
    // before:/after: : filtres de la recherche serveur, sans effet ici.
  }
  return q
}

export const isEmptyQuery = (q: LocalQuery) => !q.terms.length && !q.from && !q.in && !q.hasFile

/** Le message répond-il à la recherche (et n'est-il pas échu) ? */
export function matches(m: IndexedMsg, q: LocalQuery, now = Date.now()): boolean {
  if (m.expiresAt && Date.parse(m.expiresAt) <= now) return false
  if (q.hasFile && !m.hasFile) return false
  if (q.from && !fold(m.authorName).includes(q.from)) return false
  if (q.in && !fold(m.convName ?? '').includes(q.in)) return false
  const text = fold(m.text)
  return q.terms.every(t => text.includes(t))
}
