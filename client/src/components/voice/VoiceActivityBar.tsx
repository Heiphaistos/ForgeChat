import { useEffect, useRef, useState } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Participant {
  user_id: string
  username: string
  stream?: MediaStream
}

interface Props {
  participants: Participant[]
}

// ─── Audio level analyser per stream ─────────────────────────────────────────
function useAudioLevel(stream: MediaStream | undefined): number {
  const [level, setLevel] = useState(0)
  const rafRef = useRef<number>(0)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    if (!stream) {
      setLevel(0)
      return
    }

    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length === 0 || audioTracks[0].readyState !== 'live') {
      setLevel(0)
      return
    }

    let ctx: AudioContext
    try {
      ctx = new AudioContext()
    } catch {
      return
    }
    ctxRef.current = ctx

    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyserRef.current = analyser

    const source = ctx.createMediaStreamSource(stream)
    source.connect(analyser)

    const data = new Uint8Array(analyser.frequencyBinCount)

    const tick = () => {
      analyser.getByteFrequencyData(data)
      const avg = data.reduce((a, b) => a + b, 0) / data.length
      setLevel(avg)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafRef.current)
      try { source.disconnect() } catch {}
      try { ctx.close() } catch {}
    }
  }, [stream])

  return level
}

// ─── Speaking bars animation ──────────────────────────────────────────────────
function SpeakingBars({ level }: { level: number }) {
  const active = level > 10
  const bars = 4
  return (
    <div className="flex items-end gap-0.5 h-3">
      {Array.from({ length: bars }).map((_, i) => {
        const height = active
          ? Math.min(100, (level / 255) * 100 * (0.6 + (i % 2 === 0 ? 0.4 : 0.2)))
          : 15
        return (
          <div
            key={i}
            className={`w-0.5 rounded-full transition-all duration-75 ${active ? 'bg-fc-green' : 'bg-fc-muted/30'}`}
            style={{ height: `${height}%` }}
          />
        )
      })}
    </div>
  )
}

// ─── Single participant indicator ────────────────────────────────────────────
function ParticipantLevel({ participant }: { participant: Participant }) {
  const level = useAudioLevel(participant.stream)
  const speaking = level > 10

  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg transition ${speaking ? 'bg-fc-green/10' : 'bg-transparent'}`}>
      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold overflow-hidden flex-shrink-0
        ${speaking ? 'ring-1 ring-fc-green' : ''}`}>
        <span className="text-white">{participant.username.charAt(0).toUpperCase()}</span>
      </div>
      <span className={`text-[10px] truncate max-w-[60px] ${speaking ? 'text-white' : 'text-fc-muted'}`}>
        {participant.username}
      </span>
      <SpeakingBars level={level} />
    </div>
  )
}

// ─── Top 3 speakers mini-panel ────────────────────────────────────────────────
function TopSpeakers({ participants }: { participants: Participant[] }) {
  const withStreams = participants.filter(p => p.stream && p.stream.getAudioTracks().length > 0)
  if (withStreams.length === 0) return null

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {withStreams.slice(0, 3).map(p => (
        <ParticipantLevel key={p.user_id} participant={p} />
      ))}
      {withStreams.length > 3 && (
        <span className="text-[10px] text-fc-muted px-1">+{withStreams.length - 3}</span>
      )}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function VoiceActivityBar({ participants }: Props) {
  const withStreams = participants.filter(p => p.stream)

  if (withStreams.length === 0) return null

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-fc-sidebar/80 border-t border-fc-hover">
      <span className="text-[10px] text-fc-muted uppercase tracking-wide flex-shrink-0">
        Vocal
      </span>
      <TopSpeakers participants={withStreams} />
    </div>
  )
}
