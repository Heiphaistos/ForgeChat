import { useEffect, useRef, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { useVoice } from '../../store/voice'
import { getAudioContext } from '../../lib/audio'
import { spatialAzimuth, spatialPosition } from '../../lib/spatialAudio'
import { useSpatial } from '../../store/spatial'

/**
 * Volume au-delà de 100 % (le curseur monte à 200 %, comme Discord).
 * `HTMLMediaElement.volume` refuse toute valeur > 1 (IndexSizeError, levée en
 * plein rendu) : on amplifie par un GainNode et l'élément <audio> joue le flux
 * amplifié, ce qui garde setSinkId (choix de la sortie).
 * Un <audio> muet reste branché sur le flux d'origine : sans lui, Chrome ne fait
 * pas circuler l'audio WebRTC distant dans WebAudio.
 */
// Indexé par « pair:type » et non par flux : chaque piste (re)publiée crée un
// nouveau MediaStream, et l'ancien graphe (source, gain, <audio>) restait branché.
const _boosted = new Map<string, { src: MediaStream; out: MediaStream; node: AudioNode; gain: GainNode; panner: PannerNode; keepAlive: HTMLAudioElement }>()

function dropBoost(key: string) {
  const b = _boosted.get(key)
  if (!b) return
  b.node.disconnect()
  b.gain.disconnect()
  b.panner.disconnect()
  b.keepAlive.srcObject = null
  _boosted.delete(key)
}

/**
 * `azimuth` : voix spatiale (casque), angle du participant (lib/spatialAudio) ; null = son au centre.
 * Le graphe WebAudio (gain + PannerNode HRTF) n'est monté que si l'un des deux sert.
 */
function playable(key: string, stream: MediaStream, volume: number, azimuth: number | null): { stream: MediaStream; elementVolume: number } {
  if (volume <= 1 && azimuth === null) {
    dropBoost(key)
    return { stream, elementVolume: Math.max(0, volume) }
  }
  let b = _boosted.get(key)
  if (b && b.src !== stream) { dropBoost(key); b = undefined }
  if (!b) {
    const ctx = getAudioContext()
    const gain = ctx.createGain()
    const dst = ctx.createMediaStreamDestination()
    const node = ctx.createMediaStreamSource(stream)
    const panner = ctx.createPanner()
    panner.panningModel = 'HRTF'
    panner.distanceModel = 'linear'
    panner.rolloffFactor = 0 // même volume quelle que soit la place : seule la direction change
    node.connect(gain).connect(panner).connect(dst)
    const keepAlive = new Audio()
    keepAlive.muted = true
    keepAlive.srcObject = stream
    void keepAlive.play().catch(() => {})
    b = { src: stream, out: dst.stream, node, gain, panner, keepAlive }
    _boosted.set(key, b)
  }
  b.gain.gain.value = Math.min(Math.max(volume, 0), 2)
  const { x, z } = spatialPosition(azimuth ?? 0)
  b.panner.positionX.value = x
  b.panner.positionY.value = 0
  b.panner.positionZ.value = z
  return { stream: b.out, elementVolume: 1 }
}

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
  // Orateur prioritaire EN TRAIN DE PARLER (détection du SFU), pas seulement micro ouvert.
  const priorityTalking = useVoice(s => !!s.activePrioritySpeaker && s.sfuSpeakers.includes(s.activePrioritySpeaker))
  const spatial = useSpatial(s => s.on)
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)
  const elementsRef = useRef(new Set<HTMLAudioElement>())

  useEffect(() => {
    if (joined) return
    setAutoplayBlocked(false)
    ;[..._boosted.keys()].forEach(dropBoost)
  }, [joined])

  if (!joined) return null

  const attach = (el: HTMLAudioElement | null, key: string, stream: MediaStream, volume: number, azimuth: number | null) => {
    if (!el) return
    elementsRef.current.add(el)
    const out = playable(key, stream, volume, azimuth)
    if (el.srcObject !== out.stream) el.srcObject = out.stream
    el.volume = deafened ? 0 : out.elementVolume
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
        {peers.map((p, i) => {
          const azimuth = spatial ? spatialAzimuth(i, peers.length) : null
          const ducked = priorityTalking && activePrioritySpeaker !== p.userId ? 0.3 : 1
          const micVolume = ((userVolumes[p.userId] ?? 100) / 100) * ducked
          const screenVolume = (screenVolumes[p.userId] ?? 100) / 100
          return (
            <span key={p.userId}>
              {p.stream && p.stream.getAudioTracks().length > 0 && (
                <audio ref={el => attach(el, `${p.userId}:voice`, p.stream!, micVolume, azimuth)} autoPlay data-fc-call="voice" />
              )}
              {p.screenStream && p.screenStream.getAudioTracks().length > 0 && (
                <audio ref={el => attach(el, `${p.userId}:screen`, p.screenStream!, screenVolume, azimuth)} autoPlay data-fc-call="screen" />
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
