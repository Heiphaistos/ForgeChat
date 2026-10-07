import { create } from 'zustand'
import { useWs } from './ws'

/**
 * Salle d'attente vocale (server/src/handlers/voice_waiting.rs) :
 * VOICE_WAITING (j'attends), VOICE_ADMITTED (je peux entrer : on renvoie VOICE_JOIN),
 * VOICE_WAITING_DENIED (refusé), VOICE_WAITING_UPDATE (qui attend, pour les modérateurs).
 */
export interface WaitingUser { user_id: string; username: string }

interface WaitingState {
  /** Salon où j'attends qu'un modérateur me fasse entrer. */
  waitingIn: string | null
  /** Arrivants en attente, par salon. */
  queues: Record<string, WaitingUser[]>
}

export const useVoiceWaiting = create<WaitingState>(() => ({ waitingIn: null, queues: {} }))

export const admitWaiting = (channelId: string, userId: string, admit: boolean) =>
  useWs.getState().send({ type: admit ? 'VOICE_ADMIT' : 'VOICE_DENY', channel_id: channelId, user_id: userId })

const parseQueue = (raw: unknown): WaitingUser[] => (Array.isArray(raw) ? raw : [])
  .filter((u): u is WaitingUser => typeof u?.user_id === 'string' && typeof u?.username === 'string')
  .slice(0, 50)

/** Branché par le store vocal : `rejoin` renvoie VOICE_JOIN, `refused` sort du salon avec un message. */
export function initVoiceWaiting(current: () => string | null, rejoin: () => void, refused: () => void): () => void {
  const ws = useWs.getState()
  const offs = [
    ws.on('VOICE_WAITING', (d: any) => {
      if (d.channel_id === current()) useVoiceWaiting.setState({ waitingIn: d.channel_id })
    }),
    ws.on('VOICE_ADMITTED', (d: any) => {
      if (d.channel_id !== current()) return
      useVoiceWaiting.setState({ waitingIn: null })
      rejoin()
    }),
    ws.on('VOICE_WAITING_DENIED', (d: any) => {
      if (d.channel_id !== current()) return
      useVoiceWaiting.setState({ waitingIn: null })
      refused()
    }),
    ws.on('VOICE_EXISTING_PEERS', () => useVoiceWaiting.setState({ waitingIn: null })),
    ws.on('VOICE_WAITING_UPDATE', (d: any) => {
      if (typeof d.channel_id !== 'string') return
      useVoiceWaiting.setState(s => ({ queues: { ...s.queues, [d.channel_id]: parseQueue(d.waiting) } }))
    }),
  ]
  return () => offs.forEach(off => off())
}
