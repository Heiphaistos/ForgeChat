import { useEffect } from 'react'
import { useCallStore } from '../../store/call'
import { useAudioNotifications } from '../../hooks/useAudioNotifications'

/**
 * Lecture audio d'un appel DM (vocal ou vidéo) — montée une seule fois, hors de
 * DMPage, pour que le son ne s'arrête PAS quand on quitte la conversation
 * (Paramètres, une autre conversation...) alors que l'appel reste connecté en
 * arrière-plan (voir migration store/call.ts). Même raisonnement que
 * PersistentVoiceAudio pour les salons vocaux de serveur. Porte aussi la tonalité
 * de retour (sonnerie sortante) pour la même raison : avant, elle vivait dans un
 * effet de DMPage et s'arrêtait dès qu'on quittait la conversation en cours d'appel.
 */
export default function PersistentDmCallAudio() {
  const callState = useCallStore(s => s.callState)
  const remoteStream = useCallStore(s => s.remoteStream)
  const { playRingback } = useAudioNotifications()

  useEffect(() => {
    if (callState !== 'calling') return
    playRingback()
    const iv = setInterval(playRingback, 3000)
    return () => clearInterval(iv)
  }, [callState, playRingback])

  if (callState === 'idle' || !remoteStream) return null

  return (
    <audio
      ref={el => {
        if (!el) return
        if (el.srcObject !== remoteStream) el.srcObject = remoteStream
        const savedOut = localStorage.getItem('fc_audio_output')
        if (savedOut && 'setSinkId' in el) (el as unknown as { setSinkId: (id: string) => Promise<void> }).setSinkId(savedOut).catch(() => {})
      }}
      autoPlay
      style={{ display: 'none' }}
      aria-hidden="true"
    />
  )
}
