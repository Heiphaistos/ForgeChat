import { create } from 'zustand'

interface PresenceState {
  statuses: Map<string, string>
  setStatus: (userId: string, status: string) => void
  getStatus: (userId: string) => string
}

export const usePresence = create<PresenceState>((set, get) => ({
  statuses: new Map(),

  setStatus: (userId, status) =>
    set(s => {
      const next = new Map(s.statuses)
      next.set(userId, status)
      return { statuses: next }
    }),

  getStatus: (userId) => get().statuses.get(userId) ?? 'offline',
}))
