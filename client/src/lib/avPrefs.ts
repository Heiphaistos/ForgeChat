// Réglages audio/vidéo de cet appareil (Réglages > Voix et Vidéo).
//
// Chaque valeur garde sa propre clé localStorage `fc_*` (les clés historiques
// fc_audio_input, fc_cam_height… sont lues telles quelles ailleurs) ; ce store ne
// fait que les exposer de façon réactive, pour que la lecture des voix, le
// micro et la caméra suivent un changement sans recharger la page.
import { create } from 'zustand'

export type VadMode = 'auto' | 'manual'
export type VideoCodecPref = 'vp8' | 'vp9' | 'h264' | 'av1'
export const VIDEO_CODECS: VideoCodecPref[] = ['vp8', 'vp9', 'h264', 'av1']

export interface AvPrefs {
  /** Gain du micro en % (0 à 200), appliqué par un GainNode avant l'envoi. */
  inputVolume: number
  /** Volume général des voix et streams reçus en % (0 à 200). */
  outputVolume: number
  /** Sensibilité d'entrée : automatique (moteur + navigateur) ou seuil manuel. */
  vadMode: VadMode
  /** Seuil manuel en dBFS (-100 à 0) : en dessous, le micro transmet du silence. */
  vadThreshold: number
  /** Push-to-talk : délai avant fermeture du micro après relâchement (ms). */
  pttReleaseMs: number
  /** Annulation d'écho du navigateur (contrainte getUserMedia). */
  echoCancellation: boolean
  /** Gain automatique du navigateur ; null = suit le moteur de suppression de bruit. */
  autoGain: boolean | null
  /** Volume des sons de l'interface (notifications, arrivées) en % (0 à 100). */
  sfxVolume: number
  /** Tout le son reçu en mono (streams compris) : utile avec une seule oreille ou un seul écouteur. */
  monoOutput: boolean
  /** Atténuation (%) du son des streams pendant que quelqu'un parle dans le salon. */
  duckStreams: number
  /** Retourner horizontalement ma caméra dans MES aperçus (jamais ce que reçoivent les autres). */
  camMirror: boolean
  /** Rayon du flou d'arrière-plan (px sur l'image d'origine). */
  camBlurStrength: number
  /** Décor du fond virtuel : auto = image choisie s'il y en a une, sinon flou. */
  camBgMode: 'auto' | 'blur' | 'image' | 'color'
  /** Couleur unie du décor (#rrggbb), pour camBgMode 'color'. */
  camBgColor: string
  /** Réglages d'image appliqués à la caméra envoyée, en % (100 = neutre). */
  camBrightness: number
  camContrast: number
  camSaturation: number
  /** Toujours afficher un aperçu avant d'allumer la caméra en salon vocal. */
  camAlwaysPreview: boolean
  /** Codec vidéo préféré pour la caméra et le partage d'écran. */
  videoCodec: VideoCodecPref
  /** Plusieurs qualités envoyées en parallèle (le SFU choisit pour chaque spectateur). */
  camSimulcast: boolean
}

export const AV_DEFAULTS: AvPrefs = {
  inputVolume: 100,
  outputVolume: 100,
  vadMode: 'auto',
  vadThreshold: -50,
  pttReleaseMs: 150,
  echoCancellation: true,
  autoGain: null,
  sfxVolume: 100,
  monoOutput: false,
  duckStreams: 0,
  camMirror: true,
  camBlurStrength: 14,
  camBgMode: 'auto',
  camBgColor: '#1e1f22',
  camBrightness: 100,
  camContrast: 100,
  camSaturation: 100,
  camAlwaysPreview: false,
  videoCodec: 'vp8',
  camSimulcast: true,
}

/** Clé localStorage de chaque réglage. */
export const AV_KEYS: Record<keyof AvPrefs, string> = {
  inputVolume: 'fc_input_volume',
  outputVolume: 'fc_output_volume',
  vadMode: 'fc_vad_mode',
  vadThreshold: 'fc_vad_threshold',
  pttReleaseMs: 'fc_ptt_release_ms',
  echoCancellation: 'fc_echo_cancellation',
  autoGain: 'fc_auto_gain',
  sfxVolume: 'fc_sfx_volume',
  monoOutput: 'fc_mono_output',
  duckStreams: 'fc_duck_streams',
  camMirror: 'fc_cam_mirror',
  camBlurStrength: 'fc_cam_blur_strength',
  camBgMode: 'fc_cam_bg_mode',
  camBgColor: 'fc_cam_bg_color',
  camBrightness: 'fc_cam_brightness',
  camContrast: 'fc_cam_contrast',
  camSaturation: 'fc_cam_saturation',
  camAlwaysPreview: 'fc_cam_always_preview',
  videoCodec: 'fc_video_codec',
  camSimulcast: 'fc_cam_simulcast',
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

function readRaw(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

function num(key: string, def: number, lo: number, hi: number): number {
  const raw = readRaw(key)
  if (raw === null || raw === '') return def
  const n = Number(raw)
  return Number.isFinite(n) ? clamp(n, lo, hi) : def
}

function bool(key: string, def: boolean): boolean {
  const raw = readRaw(key)
  return raw === 'true' ? true : raw === 'false' ? false : def
}

export function loadAvPrefs(): AvPrefs {
  const d = AV_DEFAULTS
  const k = AV_KEYS
  const agc = readRaw(k.autoGain)
  const codec = readRaw(k.videoCodec)
  const color = readRaw(k.camBgColor) ?? ''
  const bgMode = readRaw(k.camBgMode)
  return {
    inputVolume: num(k.inputVolume, d.inputVolume, 0, 200),
    outputVolume: num(k.outputVolume, d.outputVolume, 0, 200),
    vadMode: readRaw(k.vadMode) === 'manual' ? 'manual' : 'auto',
    vadThreshold: num(k.vadThreshold, d.vadThreshold, -100, 0),
    pttReleaseMs: num(k.pttReleaseMs, d.pttReleaseMs, 0, 2000),
    echoCancellation: bool(k.echoCancellation, d.echoCancellation),
    autoGain: agc === 'true' ? true : agc === 'false' ? false : null,
    sfxVolume: num(k.sfxVolume, d.sfxVolume, 0, 100),
    monoOutput: bool(k.monoOutput, d.monoOutput),
    duckStreams: num(k.duckStreams, d.duckStreams, 0, 100),
    camMirror: bool(k.camMirror, d.camMirror),
    camBlurStrength: num(k.camBlurStrength, d.camBlurStrength, 2, 40),
    camBgMode: bgMode === 'blur' || bgMode === 'image' || bgMode === 'color' ? bgMode : 'auto',
    camBgColor: /^#[0-9a-f]{6}$/i.test(color) ? color : d.camBgColor,
    camBrightness: num(k.camBrightness, d.camBrightness, 50, 200),
    camContrast: num(k.camContrast, d.camContrast, 50, 200),
    camSaturation: num(k.camSaturation, d.camSaturation, 0, 200),
    camAlwaysPreview: bool(k.camAlwaysPreview, d.camAlwaysPreview),
    videoCodec: VIDEO_CODECS.find(c => c === codec) ?? d.videoCodec,
    camSimulcast: bool(k.camSimulcast, d.camSimulcast),
  }
}

interface AvPrefsStore extends AvPrefs {
  set: <K extends keyof AvPrefs>(key: K, value: AvPrefs[K]) => void
  /** Remet les réglages donnés (tous par défaut) à leur valeur d'origine. */
  reset: (keys?: (keyof AvPrefs)[]) => void
}

export const useAvPrefs = create<AvPrefsStore>((set) => ({
  ...loadAvPrefs(),
  set: (key, value) => {
    try {
      if (value === null || value === '') localStorage.removeItem(AV_KEYS[key])
      else localStorage.setItem(AV_KEYS[key], String(value))
    } catch { /* stockage bloqué : appliqué pour la session */ }
    set({ [key]: value } as Partial<AvPrefs>)
  },
  reset: (keys) => {
    const list = keys ?? (Object.keys(AV_DEFAULTS) as (keyof AvPrefs)[])
    list.forEach(k => { try { localStorage.removeItem(AV_KEYS[k]) } catch { /* rien à effacer */ } })
    set(Object.fromEntries(list.map(k => [k, AV_DEFAULTS[k]])) as Partial<AvPrefs>)
  },
}))

/** Lecture hors composant (pipeline audio, publication vidéo). */
export const avPrefs = (): AvPrefs => useAvPrefs.getState()

/** Filtre CSS/canvas des réglages d'image ; null si tout est neutre. */
export function camImageFilter(p: Pick<AvPrefs, 'camBrightness' | 'camContrast' | 'camSaturation'> = avPrefs()): string | null {
  if (p.camBrightness === 100 && p.camContrast === 100 && p.camSaturation === 100) return null
  return `brightness(${p.camBrightness}%) contrast(${p.camContrast}%) saturate(${p.camSaturation}%)`
}

/** Gain automatique effectif : explicite, sinon celui du moteur « Navigateur » seulement. */
export function effectiveAutoGain(engine: string): boolean {
  const v = avPrefs().autoGain
  return v === null ? engine === 'browser' : v
}

/**
 * Contraintes getUserMedia du micro (salon vocal, appels privés et de groupe) :
 * périphérique choisi, annulation d'écho, gain automatique et réduction de bruit du
 * navigateur. `engine` : moteur de suppression de bruit ('browser' = celle du navigateur).
 */
export function micConstraintsFor(engine: string): MediaTrackConstraints {
  const savedMicId = readRaw('fc_audio_input') || undefined
  return {
    // Voix en mono (valeur idéale, jamais bloquante) : une piste stéréo mal formée s'entendait d'un seul côté.
    channelCount: 1,
    echoCancellation: avPrefs().echoCancellation,
    noiseSuppression: engine === 'browser',
    autoGainControl: effectiveAutoGain(engine),
    ...(savedMicId ? { deviceId: { exact: savedMicId } } : {}),
  }
}

/** Contraintes de la caméra : périphérique, résolution (fc_cam_height) et images/s (fc_cam_fps). */
export function camConstraintsFromPrefs(): MediaTrackConstraints {
  const savedCamId = readRaw('fc_video_input') || undefined
  const height = Number(readRaw('fc_cam_height') ?? '720') || 720
  return {
    width: { ideal: Math.round((height * 16) / 9) },
    height: { ideal: height },
    frameRate: { ideal: Number(readRaw('fc_cam_fps') ?? '30') || 30 },
    ...(savedCamId ? { deviceId: { exact: savedCamId } } : {}),
  }
}

/** Débit maximal de la caméra (fc_cam_bitrate). */
export function camMaxBitrate(): number {
  const n = Number(readRaw('fc_cam_bitrate') ?? '1200000')
  return Number.isFinite(n) && n > 0 ? n : 1_200_000
}

/**
 * Options de publication de la caméra des appels privés et de groupe : codec, simulcast,
 * débit et images/s des Réglages (le salon vocal les applique dans store/voiceSfu.ts).
 */
export function camPublishOptions(e2ee: boolean) {
  const fps = Number(readRaw('fc_cam_fps') ?? '30') || 30
  return {
    videoCodec: videoCodecFor(e2ee),
    simulcast: avPrefs().camSimulcast,
    videoEncoding: { maxBitrate: camMaxBitrate(), maxFramerate: fps },
  }
}

/**
 * Codec vidéo à publier. Salle chiffrée de bout en bout : VP8 ou H.264 seulement
 * (le chiffrement des trames SVC VP9/AV1 n'est pas garanti par tous les clients).
 */
export function videoCodecFor(e2ee: boolean): VideoCodecPref {
  const c = avPrefs().videoCodec
  return e2ee && (c === 'vp9' || c === 'av1') ? 'vp8' : c
}
