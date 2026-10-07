import { create } from 'zustand'
import { realtime } from '@/lib/realtime'
import { parseWatch, type WatchInfo } from '@/lib/watchTogether'
import { useVoice } from './voice'

/** « Regarder ensemble » du salon vocal courant (diffusé aux seuls participants du salon). */
export const useWatch = create<{ watch: WatchInfo | null }>(() => ({ watch: null }))

const here = (cid: unknown) => typeof cid === 'string' && cid === useVoice.getState().channelId

realtime.on('WATCH_STATE', (e) => {
  if (!here(e.channel_id)) return
  const watch = parseWatch(e, Date.now())
  if (watch) useWatch.setState({ watch })
})
realtime.on('WATCH_STOP', (e) => {
  if (here(e.channel_id)) useWatch.setState({ watch: null })
})

const sync = (channelId: string | null, joined: boolean) => {
  if (joined && channelId) realtime.send({ type: 'WATCH_SYNC', channel_id: channelId })
}
// Changement de salon : oublier l'ancienne vidéo et demander celle du nouveau salon.
useVoice.subscribe((s, prev) => {
  if (s.channelId === prev.channelId && s.joined === prev.joined) return
  if (useWatch.getState().watch?.channelId !== s.channelId) useWatch.setState({ watch: null })
  sync(s.channelId, s.joined)
})
sync(useVoice.getState().channelId, useVoice.getState().joined)
