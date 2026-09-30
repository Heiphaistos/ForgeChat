import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './http'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: (count, error) => {
        // Pas de retry sur les erreurs « métier » (4xx) — seulement réseau/5xx.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
        return count < 2
      },
      refetchOnWindowFocus: false,
    },
    mutations: { retry: false },
  },
})

export const qk = {
  me: ['me'] as const,
  servers: ['servers'] as const,
  server: (id: string) => ['server', id] as const,
  channels: (serverId: string) => ['channels', serverId] as const,
  categories: (serverId: string) => ['categories', serverId] as const,
  members: (serverId: string) => ['members', serverId] as const,
  emojis: (serverId: string) => ['emojis', serverId] as const,
  search: (q: string) => ['search', q] as const,
  conversations: ['conversations'] as const,
  group: (id: string) => ['group', id] as const,
  /** Épinglés d'une conversation (id de salon, de DM ou de groupe). */
  pins: (conversationId: string) => ['pins', conversationId] as const,
  friends: (filter: string) => ['friends', filter] as const,
  friendsAll: ['friends'] as const,
  sessions: ['sessions'] as const,
  mentions: ['mentions'] as const,
  user: (id: string) => ['user', id] as const,
}
