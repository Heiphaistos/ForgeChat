import { useEffect, useRef, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { useVoice } from '../../store/voice'

/**
 * Lecture audio des pairs en salon vocal — montée une seule fois, hors de
 * VoiceVideoPage, pour que le son ne s'arrête PAS quand on quitte la page
 * de l'appel (Paramètres, autre canal...) alors que la connexion WebRTC
 * reste active en arrière-plan. VoiceVideoPage ne gère plus que l'affichage
 * (<video>, toujours muted) ; ce composant est l'unique source de lecture.
 *
 * <audio> natif plutôt que Web Audio : setSinkId (choix du périphérique de
 * sortie) y est fiable, ce qu'AudioContext ne garantit pas.
 *
 * Deux flux par pair : le micro (p.stream) et le son du partage d'écran
 * (p.screenStream), volumes indépendants — couper son micro ne doit plus couper
 * le son du jeu partagé, et le spectateur peut baisser l'un sans l'autre.
 */
export default function PersistentVoiceAudio() {
  const joined = useVoice(s => s.joined)
  const peers = useVoice(s => s.peers)
  const userVolumes = useVoice(s => s.userVolumes)
  const screenVolumes = useVoice(s => s.screenVolumes)
  const deafened = useVoice(s => s.deafened)
  const activePrioritySpeaker = useVoice(s => s.activePrioritySpeaker)
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)
  const elementsRef = useRef(new Set<HTMLAudioElement>())

  useEffect(() => {
    if (!joined) setAutoplayBlocked(false)
  }, [joined])

  if (!joined) return null

  const attach = (el: HTMLAudioElement | null, stream: MediaStream, volume: number) => {
    if (!el) return
    elementsRef.current.add(el)
    if (el.srcObject !== stream) el.srcObject = stream
    el.volume = deafened ? 0 : volume
    const savedOut = localStorage.getItem('fc_audio_output')
    // setSinkId n'est ré-appelé que si le périphérique a changé : dans une ref
    // callback, il repartait à chaque render (une promesse par rendu).
    if (savedOut && 'setSinkId' in el && (el as any)._fcSink !== savedOut) {
      ;(el as any)._fcSink = savedOut
      ;(el as unknown as { setSinkId: (id: string) => Promise<void> }).setSinkId(savedOut).catch(() => {})
    }
    // La policy autoplay peut refuser la lecture (onglet restauré, Safari) :
    // avant, l'appel était « connecté » et muet, sans aucune indication.
    el.play().then(() => setAutoplayBlocked(false)).catch(() => setAutoplayBlocked(true))
  }

  const unlock = () => {
    elementsRef.current.forEach(el => { void el.play().catch(() => {}) })
    setAutoplayBlocked(false)
  }

  return (
    <>
      <div style={{ display: 'none' }} aria-hidden="true">
        {peers.map(p => {
          const ducked = activePrioritySpeaker && activePrioritySpeaker !== p.userId ? 0.3 : 1
          const micVolume = ((userVolumes[p.userId] ?? 100) / 100) * ducked
          const screenVolume = (screenVolumes[p.userId] ?? 100) / 100
          return (
            <span key={p.userId}>
              {p.stream && p.stream.getAudioTracks().length > 0 && (
                <audio ref={el => attach(el, p.stream!, micVolume)} autoPlay data-fc-call="voice" />
              )}
              {p.screenStream && p.screenStream.getAudioTracks().length > 0 && (
                <audio ref={el => attach(el, p.screenStream!, screenVolume)} autoPlay data-fc-call="screen" />
              )}
            </span>
          )
        })}
      </div>
      {autoplayBlocked && (
        <button
          onClick={unlock}
          className="fixed bottom-20 right-4 z-[200] flex items-center gap-2 px-3 py-2 rounded-xl bg-fc-accent text-white text-sm shadow-xl"
        >
          <Volume2 size={16} /> Cliquez pour activer le son
        </button>
      )}
    </>
  )
}
