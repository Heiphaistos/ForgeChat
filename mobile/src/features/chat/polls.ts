import { isUuid } from '@/lib/params'

/** Sondage (handlers/polls.rs::PollResponse). */
export interface PollOption {
  id: string
  text: string
  votes: number
  voted: boolean
}

export interface Poll {
  id: string
  question: string
  creatorId: string
  multipleChoice: boolean
  endsAt: string | null
  options: PollOption[]
  totalVotes: number
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)

/** Réponse de GET …/polls/:id validée ; null si inexploitable. Options triées par position. */
export function normalizePoll(raw: unknown): Poll | null {
  const r = obj(raw)
  if (!isUuid(r.id) || typeof r.question !== 'string' || !Array.isArray(r.options)) return null
  const options = r.options
    .map(obj)
    .filter((o) => isUuid(o.id) && typeof o.text === 'string')
    .sort((a, b) => num(a.position) - num(b.position))
    .map((o) => ({ id: (o.id as string).toLowerCase(), text: o.text as string, votes: num(o.votes), voted: o.voted === true }))
  return {
    id: r.id.toLowerCase(),
    question: r.question,
    creatorId: typeof r.creator_id === 'string' ? r.creator_id : '',
    multipleChoice: r.multiple_choice === true,
    endsAt: typeof r.ends_at === 'string' ? r.ends_at : null,
    options,
    totalVotes: num(r.total_votes),
  }
}

export const isPollClosed = (p: Poll, now = Date.now()) => !!p.endsAt && new Date(p.endsAt).getTime() < now

/**
 * Nouvel ensemble de choix après un appui (comme PollDisplay) : choix unique = on remplace, et
 * re-toucher son choix le retire ; choix multiple = on ajoute ou retire l'option. Liste vide =
 * retirer son vote (vote_poll l'accepte).
 */
export function nextVote(p: Poll, optionId: string): string[] {
  const mine = p.options.filter((o) => o.voted).map((o) => o.id)
  if (mine.includes(optionId)) return mine.filter((id) => id !== optionId)
  return p.multipleChoice ? [...mine, optionId] : [optionId]
}

export const pollPercent = (votes: number, total: number) => (total > 0 ? Math.round((votes / total) * 100) : 0)
