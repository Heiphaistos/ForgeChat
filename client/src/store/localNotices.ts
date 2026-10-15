// Messages visibles de moi seul (réponses éphémères de commandes, erreurs de commande) :
// jamais envoyés ni stockés côté serveur, perdus au rechargement.
import { create } from 'zustand'

export interface LocalNotice {
  id: string
  command: string
  content: string
  at: number
}

const MAX_PER_CHANNEL = 20

interface State {
  byChannel: Record<string, LocalNotice[]>
  add: (channelId: string, n: Omit<LocalNotice, 'id' | 'at'>) => void
  dismiss: (channelId: string, id: string) => void
  clear: (channelId: string) => void
}

export const useLocalNotices = create<State>()(set => ({
  byChannel: {},
  add: (channelId, n) => set(s => {
    const list = [...(s.byChannel[channelId] ?? []), { ...n, id: crypto.randomUUID(), at: Date.now() }]
    return { byChannel: { ...s.byChannel, [channelId]: list.slice(-MAX_PER_CHANNEL) } }
  }),
  dismiss: (channelId, id) => set(s => ({
    byChannel: { ...s.byChannel, [channelId]: (s.byChannel[channelId] ?? []).filter(n => n.id !== id) },
  })),
  clear: channelId => set(s => ({ byChannel: { ...s.byChannel, [channelId]: [] } })),
}))
