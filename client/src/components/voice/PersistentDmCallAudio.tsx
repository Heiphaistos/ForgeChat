import { useEffect, useRef, useState } from 'react'
import { useCallStore } from '../../store/call'
import { useVoice } from '../../store/voice'
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
  // Le bouton « casque coupé » vit dans le store vocal ; c'est ici que les deux stores se
  // croisent, donc ici qu'on propage l'état à l'appel DM en cours (défaut A21).
  const deafened = useVoice(s => s.deafened)
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)
  const elRef = useRef<HTMLAudioElement | null>(null)
  const { playRingback } = useAudioNotifications()

  useEffect(() => {
    if (callState !== 'calling') return
    playRingback()
    const iv = setInterval(playRingback, 3000)
    return () => clearInterval(iv)
  }, [callState, playRingback])

  // Coupe les pistes distantes reçues (et pas seulement le volume de l'élément) : le
  // <video> de DMPage rend le même stream. remoteStream en dépendance pour réappliquer
  // l'état à un flux arrivé après le clic.
  useEffect(() => {
    useCallStore.getState().setDeafened(deafened)
  }, [deafened, remoteStream])

  if (callState === 'idle' || !remoteStream) return null

  const attach = (el: HTMLAudioElement | null) => {
    if (!el) return
    elRef.current = el
    if (el.srcObject !== remoteStream) el.srcObject = remoteStream
    el.muted = deafened
    const savedOut = localStorage.getItem('fc_audio_output')
    if (savedOut && 'setSinkId' in el) (el as unknown as { setSinkId: (id: string) => Promise<void> }).setSinkId(savedOut).catch(() => {})
    // autoPlay seul ne suffit pas : sur une policy autoplay stricte (Safari, onglet
    // restauré) la lecture est refusée et l'appel paraît connecté mais muet, sans le
    // moindre indice (défaut A18). Le rejet doit être visible et rattrapable.
    el.play().then(() => setAutoplayBlocked(false)).catch(() => setAutoplayBlocked(true))
  }

  return (
    <>
      <audio data-fc-call="dm" ref={attach} autoPlay style={{ display: 'none' }} aria-hidden="true" />
      {autoplayBlocked && (
        <button
          type="button"
          onClick={() => { elRef.current?.play().then(() => setAutoplayBlocked(false)).catch(() => {}) }}
          className="fixed bottom-20 right-4 z-50 px-4 py-2 rounded-lg bg-fc-accent text-white text-sm font-medium shadow-lg"
        >
          Cliquez pour activer le son
        </button>
      )}
    </>
  )
}
