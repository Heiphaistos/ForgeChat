import { useEffect, useRef, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { useVoice } from '../../store/voice'
import { routeAudio, dropPlaybackWhere } from '../../lib/voicePlayback'
import { spatialAzimuth } from '../../lib/spatialAudio'
import { clampVolumePct } from '../../lib/voiceMix'
import { useSpatial } from '../../store/spatial'

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
  const spatial = useSpatial(s => s.on)
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)
  const elementsRef = useRef(new Set<HTMLAudioElement>())

  useEffect(() => {
    if (joined) return
    setAutoplayBlocked(false)
    ;dropPlaybackWhere('voice:')
  }, [joined])

  if (!joined) return null

  const attach = (el: HTMLAudioElement | null, key: string, stream: MediaStream, kind: 'voice' | 'screen', volume: number, azimuth: number | null) => {
    if (!el) return
    elementsRef.current.add(el)
    routeAudio(el, key, stream, kind, volume, azimuth, deafened)
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
        {peers.map((p, i) => {
          const azimuth = spatial ? spatialAzimuth(i, peers.length) : null
          const micVolume = clampVolumePct(userVolumes[p.userId] ?? 100) / 100
          const screenVolume = clampVolumePct(screenVolumes[p.userId] ?? 100) / 100
          return (
            <span key={p.userId}>
              {p.stream && p.stream.getAudioTracks().length > 0 && (
                <audio ref={el => attach(el, `voice:${p.userId}:mic`, p.stream!, 'voice', micVolume, azimuth)} autoPlay data-fc-call="voice" />
              )}
              {p.screenStream && p.screenStream.getAudioTracks().length > 0 && (
                <audio ref={el => attach(el, `voice:${p.userId}:screen`, p.screenStream!, 'screen', screenVolume, azimuth)} autoPlay data-fc-call="screen" />
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
