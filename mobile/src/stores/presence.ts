import { create } from 'zustand'
import type { RichActivity } from '@/features/social/rich'

interface PresenceState {
  statuses: Record<string, string>
  /** Statut riche (activité, « en appel ») déjà filtré par le serveur. */
  activities: Record<string, RichActivity>
  set: (userId: string, status: string, activity?: RichActivity) => void
  bulk: (entries: { user_id: string; status: string; activity?: RichActivity }[]) => void
  reset: () => void
}

export const usePresence = create<PresenceState>((set) => ({
  statuses: {},
  activities: {},
  set: (userId, status, activity) =>
    set((s) => ({
      statuses: { ...s.statuses, [userId]: status },
      activities: activity ? { ...s.activities, [userId]: activity } : s.activities,
    })),
  bulk: (entries) =>
    set((s) => {
      const statuses = { ...s.statuses }
      const activities = { ...s.activities }
      for (const e of entries) {
        statuses[e.user_id] = e.status
        if (e.activity) activities[e.user_id] = e.activity
      }
      return { statuses, activities }
    }),
  reset: () => set({ statuses: {}, activities: {} }),
}))

export function usePresenceOf(userId: string | undefined, fallback?: string): string {
  return usePresence((s) => (userId ? s.statuses[userId] : undefined) ?? fallback ?? 'offline')
}

export function useActivityOf(userId: string | undefined): RichActivity | undefined {
  return usePresence((s) => (userId ? s.activities[userId] : undefined))
}
