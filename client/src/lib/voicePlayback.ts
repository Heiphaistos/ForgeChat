// Lecture d'un flux audio distant (salon vocal, appel MP, appel de groupe) avec volume par
// personne, voix en mono centré et voix spatiale optionnelle.
//
// `HTMLMediaElement.volume` refuse toute valeur > 1 : au-delà de 100 % on amplifie par un
// GainNode et l'élément <audio> joue le flux sorti du graphe, ce qui garde setSinkId (choix
// de la sortie). Les voix passent TOUJOURS par le graphe : un GainNode à 1 canal (« speakers »)
// force le downmix mono, sinon une piste stéréo dont un canal est vide ou décalé (client tiers,
// automate) s'entend d'un seul côté. Le PannerNode HRTF n'est créé que pour la voix spatiale.
// Un <audio> muet reste branché sur le flux d'origine : sans lui, Chrome ne fait pas circuler
// l'audio WebRTC distant dans WebAudio. Le média est déjà déchiffré (E2EE LiveKit) à ce stade.
import { getAudioContext } from './audio'
import { spatialPosition } from './spatialAudio'
import { mixPlan, type MixPlan } from './voiceMix'
import { avPrefs } from './avPrefs'

interface Graph { src: MediaStream; out: MediaStream; plan: MixPlan; nodes: AudioNode[]; gain: GainNode; panner: PannerNode | null; keepAlive: HTMLAudioElement }

// Indexé par une clé stable (« pair:type ») et non par flux : chaque piste (re)publiée crée
// un nouveau MediaStream, et l'ancien graphe restait branché.
const _graphs = new Map<string, Graph>()

export function dropPlayback(key: string) {
  const g = _graphs.get(key)
  if (!g) return
  g.nodes.forEach(n => n.disconnect())
  g.keepAlive.srcObject = null
  _graphs.delete(key)
}

export function dropPlaybackWhere(prefix: string) {
  ;[..._graphs.keys()].filter(k => k.startsWith(prefix)).forEach(dropPlayback)
}

function build(stream: MediaStream, plan: MixPlan): Graph {
  const ctx = getAudioContext()
  const node = ctx.createMediaStreamSource(stream)
  const gain = ctx.createGain()
  if (plan.mono) {
    gain.channelCount = 1
    gain.channelCountMode = 'explicit'
    gain.channelInterpretation = 'speakers'
  }
  const dst = ctx.createMediaStreamDestination()
  let panner: PannerNode | null = null
  node.connect(gain)
  if (plan.panner) {
    panner = ctx.createPanner()
    panner.panningModel = 'HRTF'
    panner.distanceModel = 'linear'
    panner.rolloffFactor = 0 // même volume quelle que soit la place : seule la direction change
    gain.connect(panner).connect(dst)
  } else {
    gain.connect(dst)
  }
  const keepAlive = new Audio()
  keepAlive.muted = true
  keepAlive.srcObject = stream
  void keepAlive.play().catch(() => {})
  return { src: stream, out: dst.stream, plan, nodes: [node, gain, ...(panner ? [panner] : []), dst], gain, panner, keepAlive }
}

/**
 * Flux à donner à l'élément <audio> et volume de l'élément.
 * `volume` : 1 = 100 % (0..2) ; `azimuth` : angle de la voix spatiale, null = désactivée.
 */
export function playable(key: string, stream: MediaStream, kind: 'voice' | 'screen', volume: number, azimuth: number | null): { stream: MediaStream; elementVolume: number } {
  // Réglages > Voix : volume général (multiplie le volume par personne) et sortie mono
  // (sans voix spatiale, qui ne peut s'entendre qu'en stéréo).
  const prefs = avPrefs()
  const mono = prefs.monoOutput
  const plan = mixPlan(kind, volume * (prefs.outputVolume / 100), mono ? null : azimuth, mono)
  // createMediaStreamSource lève InvalidStateError sur un flux sans piste audio (vidéo seule).
  if (!plan.graph || stream.getAudioTracks().length === 0) {
    dropPlayback(key)
    return { stream, elementVolume: Math.min(plan.gain, 1) }
  }
  let g = _graphs.get(key)
  if (g && (g.src !== stream || g.plan.mono !== plan.mono || g.plan.panner !== plan.panner)) { dropPlayback(key); g = undefined }
  if (!g) { g = build(stream, plan); _graphs.set(key, g) }
  g.gain.gain.value = plan.gain
  if (g.panner) {
    const { x, z } = spatialPosition(azimuth ?? 0)
    g.panner.positionX.value = x
    g.panner.positionY.value = 0
    g.panner.positionZ.value = z
  }
  return { stream: g.out, elementVolume: 1 }
}

/** Branche le flux (graphe compris) sur l'élément et la sortie choisie dans Réglages. */
export function routeAudio(el: HTMLAudioElement, key: string, stream: MediaStream, kind: 'voice' | 'screen', volume: number, azimuth: number | null, deafened: boolean) {
  const out = playable(key, stream, kind, volume, azimuth)
  if (el.srcObject !== out.stream) el.srcObject = out.stream
  el.volume = deafened ? 0 : out.elementVolume
  const savedOut = localStorage.getItem('fc_audio_output')
  // setSinkId n'est ré-appelé que si le périphérique a changé (une promesse par rendu sinon).
  const sinkable = el as HTMLAudioElement & { _fcSink?: string; setSinkId?: (id: string) => Promise<void> }
  if (savedOut && sinkable.setSinkId && sinkable._fcSink !== savedOut) {
    sinkable._fcSink = savedOut
    sinkable.setSinkId(savedOut).catch(() => {})
  }
}

/**
 * Sortie audio choisie (Réglages ou menu du casque) : mémorisée, puis appliquée tout de suite
 * aux seuls éléments d'appel (pas aux lecteurs de pièces jointes ni aux vidéos des messages).
 */
export function setAudioOutput(id: string) {
  localStorage.setItem('fc_audio_output', id)
  document.querySelectorAll<HTMLMediaElement & { _fcSink?: string }>('audio[data-fc-call], video[data-fc-call]').forEach(el => {
    if (!('setSinkId' in el)) return
    el._fcSink = id
    el.setSinkId(id).catch(() => {})
  })
}
