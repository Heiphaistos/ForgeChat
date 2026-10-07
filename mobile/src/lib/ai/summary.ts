// Résumé EXTRACTIF des messages non lus, calculé sur l'appareil sans aucun modèle :
// on garde les messages les plus porteurs (TF-IDF, mentions, réactions, longueur, liens)
// et on les rend dans l'ordre chronologique. Recopié tel quel de client/src/ai/summary.ts
// (seul le chemin d'import diffère) : garder les deux identiques.
import { STOPWORDS, words } from './text'

export interface SummaryInput {
  id: string
  author: string
  text: string
  reactions?: number
  mentionsMe?: boolean
  attachments?: number
}

export interface Summary {
  count: number
  authors: { name: string; count: number }[]
  keywords: string[]
  highlights: { id: string; author: string; text: string }[]
}

const STOP = new Set(Object.values(STOPWORDS).flatMap(s => [...s]))
const fold = (w: string) => w.normalize('NFD').replace(/\p{M}/gu, '')
const terms = (text: string) =>
  words(text.replace(/https?:\/\/\S+|<[@#:][^>]*>/g, ' ')).filter(w => w.length >= 3 && !STOP.has(w)).map(fold)

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)
const count = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1)

export function summarize(msgs: SummaryInput[], max = 5): Summary {
  const docs = msgs.map(m => ({ m, terms: terms(m.text) }))
  const df = new Map<string, number>()
  for (const d of docs) for (const t of new Set(d.terms)) count(df, t)
  const idf = (t: string) => Math.log(1 + msgs.length / (df.get(t) ?? 1))

  // Mots-clés : termes présents dans au moins deux messages, les plus fréquents d'abord.
  const total = new Map<string, number>()
  for (const d of docs) for (const t of d.terms) count(total, t)
  const keywords = [...total].filter(([t]) => (df.get(t) ?? 0) >= 2)
    .sort((a, b) => b[1] * idf(b[0]) - a[1] * idf(a[0])).slice(0, 5).map(([t]) => t)

  const scored = docs.map(({ m, terms: d }, i) => {
    const tfidf = d.reduce((s, t) => s + idf(t), 0) / Math.sqrt(d.length || 1)
    const score = tfidf
      + d.filter(t => keywords.includes(t)).length * 0.3
      + (m.mentionsMe ? 3 : 0)
      + Math.log2(1 + (m.reactions ?? 0))
      + Math.min(m.text.length / 200, 1)
      + (/https?:\/\//.test(m.text) ? 0.5 : 0)
      + ((m.attachments ?? 0) > 0 ? 0.3 : 0)
    // Trop court pour résumer quoi que ce soit (« ok », « mdr ») sauf s'il me concerne.
    const tooShort = m.text.trim().length < 12 && !m.mentionsMe
    return { i, m, score: tooShort ? -1 : score }
  })
  const keep = scored.filter(s => s.score >= 0).sort((a, b) => b.score - a.score).slice(0, max).sort((a, b) => a.i - b.i)

  const byAuthor = new Map<string, number>()
  for (const m of msgs) count(byAuthor, m.author)
  return {
    count: msgs.length,
    authors: [...byAuthor].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, count: n })),
    keywords,
    highlights: keep.map(({ m }) => ({ id: m.id, author: m.author, text: clip(m.text.replace(/\s+/g, ' ').trim(), 200) })),
  }
}
