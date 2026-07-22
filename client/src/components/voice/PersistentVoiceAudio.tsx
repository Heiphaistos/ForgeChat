import { useVoice } from '../../store/voice'

/**
 * Lecture audio des pairs en salon vocal — montée une seule fois, hors de
 * VoiceVideoPage, pour que le son ne s'arrête PAS quand on quitte la page
 * de l'appel (Paramètres, autre canal...) alors que la connexion WebRTC
 * reste active en arrière-plan. VoiceVideoPage ne gère plus que l'affichage
 * (<video>, toujours muted pour les pairs distants) ; ce composant est
 * l'unique source de lecture audio, qu'on soit sur la page de l'appel ou non.
 *
 * <audio> natif plutôt que Web Audio/AudioContext : supporte setSinkId
 * (sélection du périphérique de sortie, déjà en place) de façon fiable
 * cross-browser, ce qu'AudioContext ne garantit pas.
 */
export default function PersistentVoiceAudio() {
  const joined = useVoice(s => s.joined)
  const peers = useVoice(s => s.peers)
  const userVolumes = useVoice(s => s.userVolumes)
  const activePrioritySpeaker = useVoice(s => s.activePrioritySpeaker)

  if (!joined) return null

  return (
    <div style={{ display: 'none' }} aria-hidden="true">
      {peers.map(p => {
        if (!p.stream || p.stream.getAudioTracks().length === 0) return null
        const base = (userVolumes[p.userId] ?? 100) / 100
        const ducked = activePrioritySpeaker && activePrioritySpeaker !== p.userId ? 0.3 : 1
        return (
          <audio
            key={p.userId}
            ref={el => {
              if (!el) return
              if (el.srcObject !== p.stream) el.srcObject = p.stream
              el.volume = base * ducked
              const savedOut = localStorage.getItem('fc_audio_output')
              if (savedOut && 'setSinkId' in el) (el as unknown as { setSinkId: (id: string) => Promise<void> }).setSinkId(savedOut).catch(() => {})
            }}
            autoPlay
          />
        )
      })}
    </div>
  )
}
