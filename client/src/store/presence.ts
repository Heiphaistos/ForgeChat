import { create } from 'zustand'

interface ActivityInfo {
  activity_type?: string
  activity_name?: string
  activity_detail?: string
}

interface PresenceState {
  statuses: Record<string, string>
  activities: Record<string, ActivityInfo>
  setStatus: (userId: string, status: string) => void
  getStatus: (userId: string) => string
  setActivity: (userId: string, activity: ActivityInfo) => void
  getActivity: (userId: string) => ActivityInfo | undefined
}

export const usePresence = create<PresenceState>((set, get) => ({
  statuses: {},
  activities: {},

  setStatus: (userId, status) =>
    set(s => ({ statuses: { ...s.statuses, [userId]: status } })),

  getStatus: (userId) => get().statuses[userId] ?? 'offline',

  setActivity: (userId, activity) =>
    set(s => ({ activities: { ...s.activities, [userId]: activity } })),

  getActivity: (userId) => get().activities[userId],
}))
