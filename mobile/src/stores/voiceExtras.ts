import { create } from 'zustand'
import { realtime } from '@/lib/realtime'
import { initVoiceFx, startVolumePtt } from '@/services/voiceFx'
import { useVoice } from './voice'
import { useVoiceFx } from './voiceFx'

/**
 * Compléments du salon vocal, branchés une fois au démarrage (import dans src/app/_layout.tsx) :
 *  - salle d'attente côté modérateur : VOICE_WAITING_UPDATE { channel_id, waiting } → file affichée,
 *    VOICE_ADMIT / VOICE_DENY envoyés (le serveur vérifie MOVE_MEMBERS) ;
 *  - appuyer pour parler avec la touche volume bas (Android, option des réglages Voix et vidéo) ;
 *  - effets locaux (suppression de bruit, fond virtuel) alignés sur les réglages.
 */
export interface WaitingUser {
  userId: string
  username: string
}

export const useVoiceWaitingQueue = create<{ queues: Record<string, WaitingUser[]> }>(() => ({ queues: {} }))

/** File d'attente reçue, validée (50 au plus, comme le serveur). */
export function parseWaiting(raw: unknown): WaitingUser[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((u): u is { user_id: string; username: string } => typeof u?.user_id === 'string' && typeof u?.username === 'string')
    .slice(0, 50)
    .map((u) => ({ userId: u.user_id, username: u.username.slice(0, 64) }))
}

realtime.on('VOICE_WAITING_UPDATE', (e) => {
  if (typeof e.channel_id !== 'string') return
  const channelId = e.channel_id
  useVoiceWaitingQueue.setState((s) => ({ queues: { ...s.queues, [channelId]: parseWaiting(e.waiting) } }))
})

export const admitWaiting = (channelId: string, userId: string, admit: boolean) =>
  realtime.send({ type: admit ? 'VOICE_ADMIT' : 'VOICE_DENY', channel_id: channelId, user_id: userId })

// ── Appuyer pour parler (touche volume bas) : micro ouvert seulement pendant l'appui ──
let stopPtt: (() => void) | null = null
const pttWanted = () => {
  const v = useVoice.getState()
  return useVoiceFx.getState().volumePtt && v.joined && !v.listenOnly && !v.waiting
}
function syncPtt() {
  const want = pttWanted()
  if (want && !stopPtt) {
    if (!useVoice.getState().muted) useVoice.getState().toggleMute()
    stopPtt = startVolumePtt((down) => {
      const v = useVoice.getState()
      if (down === v.muted) v.toggleMute()
    })
  } else if (!want && stopPtt) {
    stopPtt()
    stopPtt = null
  }
}
useVoice.subscribe(syncPtt)
useVoiceFx.subscribe(syncPtt)

initVoiceFx()
