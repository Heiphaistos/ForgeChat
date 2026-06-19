import { create } from 'zustand'

interface ActivityInfo {
  activity_type?: string
  activity_name?: string
  activity_detail?: string
}

interface PresenceState {
  statuses: Map<string, string>
  activities: Map<string, ActivityInfo>
  setStatus: (userId: string, status: string) => void
  getStatus: (userId: string) => string
  setActivity: (userId: string, activity: ActivityInfo) => void
  getActivity: (userId: string) => ActivityInfo | undefined
}

export const usePresence = create<PresenceState>((set, get) => ({
  statuses: new Map(),
  activities: new Map(),

  setStatus: (userId, status) =>
    set(s => {
      const next = new Map(s.statuses)
      next.set(userId, status)
      return { statuses: next }
    }),

  getStatus: (userId) => get().statuses.get(userId) ?? 'offline',

  setActivity: (userId, activity) =>
    set(s => {
      const next = new Map(s.activities)
      next.set(userId, activity)
      return { activities: next }
    }),

  getActivity: (userId) => get().activities.get(userId),
}))
