import { fromServerMessage } from '@/features/chat/adapters'
import { isPollClosed, nextVote, normalizePoll, pollPercent, type Poll } from '@/features/chat/polls'
import type { ServerMessage } from '@/types/models'

const P = '3af17b11-1c9a-4daf-8895-a2d3eec03894'
const A = '5aa172f3-305c-4685-bd77-64faf6b911eb'
const B = '9b1f4c2e-0d3a-4e5b-8c6d-7e8f9a0b1c2d'
const C = '0c6a4e0e-7b7d-4f1a-9f43-2b1d5d6e7f80'

const raw = {
  id: P,
  question: 'Pizza ?',
  channel_id: A,
  creator_id: B,
  multiple_choice: false,
  anonymous: false,
  ends_at: null,
  created_at: '2026-10-01T10:00:00Z',
  options: [
    { id: B, text: 'Non', position: 1, votes: 1, voted: false },
    { id: A, text: 'Oui', position: 0, votes: 3, voted: true },
    { id: 'pas-un-uuid', text: 'x', position: 2, votes: 9, voted: false },
  ],
  total_votes: 4,
}

describe('normalizePoll', () => {
  it('lit polls.rs::PollResponse, trie par position et ignore les options invalides', () => {
    const p = normalizePoll(raw)!
    expect(p).toMatchObject({ id: P, question: 'Pizza ?', creatorId: B, multipleChoice: false, endsAt: null, totalVotes: 4 })
    expect(p.options.map((o) => o.text)).toEqual(['Oui', 'Non'])
    expect(p.options[0]).toEqual({ id: A, text: 'Oui', votes: 3, voted: true })
  })

  it('rejette une réponse inexploitable', () => {
    expect(normalizePoll(null)).toBeNull()
    expect(normalizePoll({ ...raw, id: 'x' })).toBeNull()
    expect(normalizePoll({ ...raw, options: 'x' })).toBeNull()
  })

  it('compteurs négatifs ou absents ramenés à 0', () => {
    expect(normalizePoll({ ...raw, total_votes: -2, options: [{ id: A, text: 'Oui' }] })).toMatchObject({ totalVotes: 0, options: [{ votes: 0, voted: false }] })
  })
})

describe('nextVote (même règle que PollDisplay)', () => {
  const single = normalizePoll(raw)!
  const multi: Poll = { ...single, multipleChoice: true, options: [...single.options, { id: C, text: 'Bof', votes: 0, voted: true }] }

  it('choix unique : remplace, et re-toucher son choix le retire', () => {
    expect(nextVote(single, B)).toEqual([B])
    expect(nextVote(single, A)).toEqual([])
  })

  it('choix multiple : ajoute ou retire l’option', () => {
    expect(nextVote(multi, B)).toEqual([A, C, B])
    expect(nextVote(multi, C)).toEqual([A])
  })
})

describe('affichage', () => {
  it('pourcentages arrondis, 0 sans vote', () => {
    expect(pollPercent(1, 3)).toBe(33)
    expect(pollPercent(2, 3)).toBe(67)
    expect(pollPercent(0, 0)).toBe(0)
  })

  it('terminé quand ends_at est passé', () => {
    const p = normalizePoll({ ...raw, ends_at: '2026-10-01T10:00:00Z' })!
    expect(isPollClosed(p, Date.parse('2026-10-01T09:59:00Z'))).toBe(false)
    expect(isPollClosed(p, Date.parse('2026-10-01T10:01:00Z'))).toBe(true)
    expect(isPollClosed(normalizePoll(raw)!)).toBe(false)
  })

  it('le message de salon porte poll_id', () => {
    const m = { id: A, channel_id: B, content: '📊 Pizza ?', created_at: '2026-10-01T10:00:00Z', author_id: C, author_username: 'a', poll_id: P } as ServerMessage
    expect(fromServerMessage(m).pollId).toBe(P)
    expect(fromServerMessage({ ...m, poll_id: undefined }).pollId).toBeNull()
  })
})
