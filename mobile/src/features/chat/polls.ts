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

// ─── Création (POST …/polls, polls.rs::CreatePollBody) ───────────────────────

export const POLL_QUESTION_MAX = 300
export const POLL_OPTIONS_MIN = 2
export const POLL_OPTIONS_MAX = 10
export const POLL_OPTION_MAX_CHARS = 100

/** Durées proposées (heures) ; null = sans fin. */
export const POLL_DURATIONS: readonly { label: string; hours: number | null }[] = [
  { label: 'Sans fin', hours: null },
  { label: '1 heure', hours: 1 },
  { label: '4 heures', hours: 4 },
  { label: '24 heures', hours: 24 },
  { label: '3 jours', hours: 72 },
  { label: '1 semaine', hours: 168 },
]

export type PollBody = { question: string; options: string[]; multiple_choice: boolean; ends_at?: string }

/** Corps validé, ou message d'erreur en français (mêmes bornes que le serveur). */
export function pollBody(question: string, options: readonly string[], multiple: boolean, hours: number | null, now = Date.now()): PollBody | string {
  const q = question.trim()
  if (!q) return 'La question est obligatoire.'
  if (q.length > POLL_QUESTION_MAX) return `Question trop longue (${POLL_QUESTION_MAX} caractères max).`
  const opts = options.map((o) => o.trim()).filter(Boolean)
  if (opts.length < POLL_OPTIONS_MIN || opts.length > POLL_OPTIONS_MAX) return `Entre ${POLL_OPTIONS_MIN} et ${POLL_OPTIONS_MAX} options.`
  if (new Set(opts.map((o) => o.toLocaleLowerCase())).size !== opts.length) return 'Deux options sont identiques.'
  const body: PollBody = { question: q, options: opts, multiple_choice: multiple }
  if (hours) body.ends_at = new Date(now + hours * 3_600_000).toISOString()
  return body
}
