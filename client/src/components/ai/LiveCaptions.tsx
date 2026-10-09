// Sous-titres en direct d'un appel : le son REÇU (déjà déchiffré par LiveKit/WebRTC)
// est découpé en phrases et transcrit par Whisper SUR L'APPAREIL. Les sous-titres ne
// sont affichés qu'ici, jamais envoyés à qui que ce soit.
import { useEffect, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { transcribe } from '../../ai/engine'
import { RATE, SpeechChunker, resample } from '../../ai/audio'

export interface CaptionSource { id: string; name: string; stream: MediaStream | null }
interface Caption { key: number; name: string; text: string; at: number }

const SHOW_MS = 8000
const MAX_QUEUE = 2

export default function LiveCaptions({ sources }: { sources: CaptionSource[] }) {
  const t = useT()
  const [lines, setLines] = useState<Caption[]>([])
  const queue = useRef<{ id: string; name: string; pcm: Float32Array }[]>([])
  // Langue détectée par interlocuteur : évite de refaire la détection à chaque phrase.
  const langs = useRef(new Map<string, string>())
  const working = useRef(false)
  const seq = useRef(0)

  // Un seul morceau transcrit à la fois ; en retard, on jette le plus ancien
  // (mieux vaut un sous-titre manqué qu'un sous-titre en retard de 30 s).
  const pump = async () => {
    if (working.current) return
    working.current = true
    try {
      for (let job = queue.current.shift(); job; job = queue.current.shift()) {
        const long = job.pcm.length >= 3 * RATE // avant transfert du tampon au Worker
        const r = await transcribe(job.pcm, { ask: false, language: langs.current.get(job.id), pack: 'whisper' }).catch(() => null)
        // Langue retenue seulement sur une phrase assez longue (détection fiable).
        if (r?.lang && long) langs.current.set(job.id, r.lang)
        const text = r?.text ?? ''
        if (text && !/^\[.*\]$|^\(.*\)$/.test(text)) {
          const name = job.name
          setLines(l => [...l.slice(-2), { key: seq.current++, name, text, at: Date.now() }])
        }
      }
    } finally {
      working.current = false
    }
  }

  const key = sources.map(s => `${s.id}:${s.stream?.id ?? ''}`).join('|')
  useEffect(() => {
    const ctx = new AudioContext()
    const sink = ctx.createGain()
    sink.gain.value = 0
    sink.connect(ctx.destination)
    const nodes: AudioNode[] = []
    for (const s of sources) {
      if (!s.stream?.getAudioTracks().length) continue
      const src = ctx.createMediaStreamSource(s.stream)
      // ScriptProcessor : déprécié mais partout disponible, sans fichier de worklet (CSP).
      const proc = ctx.createScriptProcessor(4096, 1, 1)
      const chunker = new SpeechChunker()
      proc.onaudioprocess = e => {
        const pcm = chunker.push(resample(new Float32Array(e.inputBuffer.getChannelData(0)), ctx.sampleRate))
        if (!pcm) return
        queue.current.push({ id: s.id, name: s.name, pcm })
        while (queue.current.length > MAX_QUEUE) queue.current.shift()
        void pump()
      }
      src.connect(proc)
      proc.connect(sink)
      nodes.push(src, proc)
    }
    return () => {
      for (const n of nodes) n.disconnect()
      queue.current = []
      void ctx.close()
    }
  }, [key])

  // Efface les sous-titres anciens.
  useEffect(() => {
    if (!lines.length) return
    const id = setTimeout(() => setLines(l => l.filter(c => Date.now() - c.at < SHOW_MS)), 1000)
    return () => clearTimeout(id)
  }, [lines])

  return (
    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-3/4 max-w-2xl pointer-events-none space-y-1" aria-live="polite">
      {lines.length === 0 ? (
        <div className="bg-black/60 text-white/70 text-xs text-center rounded-lg px-3 py-1.5">{t('ai.captions.waiting')}</div>
      ) : lines.map(c => (
        <div key={c.key} className="bg-black/80 text-white text-sm text-center rounded-lg px-4 py-2">
          <span className="font-semibold mr-1.5">{c.name} :</span>{c.text}
        </div>
      ))}
    </div>
  )
}
