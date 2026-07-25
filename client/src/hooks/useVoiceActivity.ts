import { useEffect, useRef, useState } from 'react'

const SPEAKING_THRESHOLD = 18
const SAMPLE_INTERVAL = 80

interface PeerAnalyser {
  ctx: AudioContext
  analyser: AnalyserNode
  data: Uint8Array<ArrayBuffer>
  stream: MediaStream
}

// Variante multi-pairs de useVoiceActivity ci-dessous : un seul AnalyserNode par pair
// distant (indexé par userId), partagés entre tous les tiles d'une page d'appel. Sans
// ça, l'indicateur "en train de parler" des pairs distants était figé en dur à false
// (aucun événement WS SPEAKING n'existe côté serveur) -- seul le tile local réagissait.
export function usePeersVoiceActivity(peers: { userId: string; stream: MediaStream | null }[]): Record<string, number> {
  const [levels, setLevels] = useState<Record<string, number>>({})
  const analysersRef = useRef<Map<string, PeerAnalyser>>(new Map())

  useEffect(() => {
    const analysers = analysersRef.current

    for (const [userId, entry] of Array.from(analysers.entries())) {
      const p = peers.find(pp => pp.userId === userId)
      const stillValid = p && p.stream && p.stream === entry.stream && p.stream.getAudioTracks().length > 0
      if (!stillValid) {
        entry.ctx.close()
        analysers.delete(userId)
      }
    }

    for (const p of peers) {
      if (!p.stream || p.stream.getAudioTracks().length === 0) continue
      if (analysers.has(p.userId)) continue
      try {
        const ctx = new AudioContext()
        const source = ctx.createMediaStreamSource(p.stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = 0.3
        source.connect(analyser)
        analysers.set(p.userId, { ctx, analyser, data: new Uint8Array(analyser.frequencyBinCount), stream: p.stream })
      } catch {
        // AudioContext non disponible
      }
    }
  }, [peers])

  useEffect(() => {
    const id = setInterval(() => {
      const next: Record<string, number> = {}
      for (const [userId, { analyser, data }] of analysersRef.current) {
        analyser.getByteFrequencyData(data)
        const avg = data.slice(0, data.length / 2).reduce((a, b) => a + b, 0) / (data.length / 2)
        next[userId] = avg > SPEAKING_THRESHOLD ? 1 : 0
      }
      setLevels(next)
    }, SAMPLE_INTERVAL)
    return () => clearInterval(id)
  }, [])

  useEffect(() => () => {
    for (const entry of analysersRef.current.values()) entry.ctx.close()
    analysersRef.current.clear()
  }, [])

  return levels
}

export function useVoiceActivity(stream: MediaStream | null, enabled = true): boolean {
  const [speaking, setSpeaking] = useState(false)
  const ctxRef = useRef<AudioContext | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!stream || !enabled) {
      setSpeaking(false)
      return
    }

    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length === 0) return

    try {
      const ctx = new AudioContext()
      ctxRef.current = ctx

      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.3
      source.connect(analyser)

      const data = new Uint8Array(analyser.frequencyBinCount)

      timerRef.current = setInterval(() => {
        analyser.getByteFrequencyData(data)
        const avg = data.slice(0, data.length / 2).reduce((a, b) => a + b, 0) / (data.length / 2)
        setSpeaking(avg > SPEAKING_THRESHOLD)
      }, SAMPLE_INTERVAL)

      return () => {
        clearInterval(timerRef.current!)
        ctx.close()
        setSpeaking(false)
      }
    } catch {
      // AudioContext non disponible
    }
  }, [stream, enabled])

  return speaking
}
