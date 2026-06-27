import { create } from 'zustand'

export interface IncomingCallInfo {
  fromUserId: string
  fromUsername: string
  dmId: string
  callType: 'voice' | 'video'
}

interface CallStore {
  incomingCall: IncomingCallInfo | null
  pendingAccept: { fromUserId: string; callType: 'voice' | 'video' } | null
  setIncomingCall: (c: IncomingCallInfo | null) => void
  setPendingAccept: (a: { fromUserId: string; callType: 'voice' | 'video' } | null) => void
}

export const useCallStore = create<CallStore>((set) => ({
  incomingCall: null,
  pendingAccept: null,
  setIncomingCall: (incomingCall) => set({ incomingCall }),
  setPendingAccept: (pendingAccept) => set({ pendingAccept }),
}))
