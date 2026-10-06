import { create } from 'zustand'

interface PresenceState {
  statuses: Record<string, string>
  set: (userId: string, status: string) => void
  bulk: (entries: { user_id: string; status: string }[]) => void
  reset: () => void
}

export const usePresence = create<PresenceState>((set) => ({
  statuses: {},
  set: (userId, status) => set((s) => ({ statuses: { ...s.statuses, [userId]: status } })),
  bulk: (entries) =>
    set((s) => {
      const next = { ...s.statuses }
      for (const e of entries) next[e.user_id] = e.status
      return { statuses: next }
    }),
  reset: () => set({ statuses: {} }),
}))

export function usePresenceOf(userId: string | undefined, fallback?: string): string {
  return usePresence((s) => (userId ? s.statuses[userId] : undefined) ?? fallback ?? 'offline')
}
