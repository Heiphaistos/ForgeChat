import { create } from 'zustand'

/** Messages visibles de moi seul (réponses éphémères de commandes) : jamais envoyés ni stockés, perdus au redémarrage. */
export interface LocalNotice { id: string; command: string; content: string }

const MAX_PER_CHANNEL = 20
let seq = 0

interface State {
  byChannel: Record<string, LocalNotice[]>
  add: (channelId: string, n: Omit<LocalNotice, 'id'>) => void
  dismiss: (channelId: string, id: string) => void
}

export const useLocalNotices = create<State>((set) => ({
  byChannel: {},
  add: (channelId, n) =>
    set((s) => ({ byChannel: { ...s.byChannel, [channelId]: [...(s.byChannel[channelId] ?? []), { ...n, id: `n${++seq}` }].slice(-MAX_PER_CHANNEL) } })),
  dismiss: (channelId, id) =>
    set((s) => ({ byChannel: { ...s.byChannel, [channelId]: (s.byChannel[channelId] ?? []).filter((n) => n.id !== id) } })),
}))
