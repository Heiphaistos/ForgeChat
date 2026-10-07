import { create } from 'zustand'

// Clips (comme Discord) : garder en mémoire les dernières secondes d'un stream
// pour pouvoir les enregistrer après coup.
//
// Un fichier WebM n'est lisible que s'il commence par l'en-tête écrit au début
// de l'enregistrement : on ne peut pas jeter les vieux fragments d'un même
// MediaRecorder. D'où deux enregistreurs décalés de 30 s, chacun redémarré à
// 60 s : il y en a toujours un qui a entre 30 et 60 s de recul, et c'est lui qui
// donne le clip (fichier complet, en-tête compris).
// ponytail: le clip dure 30 à 60 s et le tampon garde au pire 90 s de flux
// (60 + 30) ; découper exactement 30 s demanderait de réencoder.

const CYCLE_MS = 30_000
const KEY = 'fc_clips'

const MIME = typeof MediaRecorder === 'undefined' ? '' : [
  'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4',
].find(t => MediaRecorder.isTypeSupported(t)) ?? ''

export const clipExtension = (blob: Blob) => blob.type.includes('mp4') ? 'mp4' : 'webm'

export interface ClipBuffer {
  /** Les dernières secondes (30 à 60) depuis l'enregistreur le plus ancien ; null si rien. */
  clip(): Promise<Blob | null>
  stop(): void
}

interface Slot { rec: MediaRecorder; chunks: Blob[]; startedAt: number }

export function startClipBuffer(stream: MediaStream): ClipBuffer {
  const slots: (Slot | null)[] = [null, null]

  const drop = (s: Slot | null) => {
    if (!s) return
    s.rec.ondataavailable = null
    if (s.rec.state !== 'inactive') s.rec.stop()
  }

  const restart = (i: number) => {
    drop(slots[i])
    slots[i] = null
    try {
      const rec = new MediaRecorder(stream, MIME ? { mimeType: MIME } : undefined)
      const slot: Slot = { rec, chunks: [], startedAt: Date.now() }
      rec.ondataavailable = e => { if (e.data.size > 0) slot.chunks.push(e.data) }
      rec.start(1000)
      slots[i] = slot
    } catch (e) {
      console.warn('[clips] enregistreur indisponible', e)
    }
  }

  // t=0 : 0 démarre ; t=30 : 1 démarre ; t=60 : 0 repart à zéro ; t=90 : 1...
  restart(0)
  let next = 1
  const timer = setInterval(() => { restart(next); next = 1 - next }, CYCLE_MS)

  return {
    async clip() {
      const s = slots.filter((x): x is Slot => !!x && x.rec.state === 'recording')
        .sort((a, b) => a.startedAt - b.startedAt)[0]
      if (!s) return null
      // Vide la seconde en cours avant d'assembler (le gestionnaire d'origine,
      // inscrit avant, range le fragment avant que cet écouteur ne se réveille).
      await new Promise<void>(resolve => {
        s.rec.addEventListener('dataavailable', () => resolve(), { once: true })
        try { s.rec.requestData() } catch { resolve() }
      })
      return s.chunks.length ? new Blob(s.chunks, { type: s.rec.mimeType || MIME || 'video/webm' }) : null
    },
    stop() {
      clearInterval(timer)
      slots.forEach(drop)
      slots.fill(null)
    },
  }
}

const readEnabled = () => { try { return localStorage.getItem(KEY) === 'true' } catch { return false } }

/** Réglage « Clips » (Réglages > Vidéo), désactivé par défaut : vie privée et mémoire. */
export const useClipsSetting = create<{ enabled: boolean; setEnabled(on: boolean): void }>(set => ({
  enabled: readEnabled(),
  setEnabled: on => {
    try { localStorage.setItem(KEY, String(on)) } catch { /* stockage indisponible : réglage de session */ }
    set({ enabled: on })
  },
}))
