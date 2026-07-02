import { useState, useRef, useCallback, useEffect } from 'react'
import { Mic, Square, Send, X } from 'lucide-react'

interface Props {
  onSend: (blob: Blob, duration: number) => void
  onCancel: () => void
}

export default function VoiceMessageRecorder({ onSend, onCancel }: Props) {
  const [state, setState] = useState<'recording' | 'preview'>('recording')
  const [duration, setDuration] = useState(0)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const blobRef = useRef<Blob | null>(null)
  const blobUrlRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    recorderRef.current?.stop()
    recorderRef.current = null
  }, [])

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4']
        .find(t => MediaRecorder.isTypeSupported(t)) ?? ''
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' })
        blobRef.current = blob
        const url = URL.createObjectURL(blob)
        blobUrlRef.current = url
        setBlobUrl(url)
        setState('preview')
        stream.getTracks().forEach(t => t.stop())
        streamRef.current = null
      }
      recorder.start(100)
      recorderRef.current = recorder

      let secs = 0
      timerRef.current = setInterval(() => {
        secs++
        setDuration(secs)
        if (secs >= 120) stop()
      }, 1000)
    } catch {
      onCancel()
    }
  }, [onCancel, stop])

  useEffect(() => {
    start()
    return () => {
      stop()
      streamRef.current?.getTracks().forEach(t => t.stop())
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
    }
  }, [start, stop])

  const handleSend = () => {
    if (!blobRef.current) return
    onSend(blobRef.current, duration)
    if (blobUrl) URL.revokeObjectURL(blobUrl)
  }

  const handleCancel = () => {
    stop()
    streamRef.current?.getTracks().forEach(t => t.stop())
    if (blobUrl) URL.revokeObjectURL(blobUrl)
    onCancel()
  }

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-fc-channel rounded-xl border border-fc-hover">
      {state === 'recording' ? (
        <>
          <div className="w-2 h-2 rounded-full bg-fc-red animate-pulse flex-shrink-0" />
          <span className="text-fc-red text-sm font-mono w-10 flex-shrink-0">{fmt(duration)}</span>
          <div className="flex-1 h-1 bg-fc-hover rounded-full overflow-hidden">
            <div className="h-full bg-fc-red/50 rounded-full" style={{ width: `${(duration / 120) * 100}%` }} />
          </div>
          <button onClick={stop} className="p-1.5 bg-fc-red/20 rounded-lg text-fc-red hover:bg-fc-red/30" title="Arrêter">
            <Square size={14} />
          </button>
          <button onClick={handleCancel} className="p-1.5 bg-fc-hover rounded-lg text-fc-muted hover:text-white" title="Annuler">
            <X size={14} />
          </button>
        </>
      ) : (
        <>
          <span className="text-xs text-fc-muted flex-shrink-0">{fmt(duration)}</span>
          {blobUrl && (
            <audio src={blobUrl} controls className="h-7 flex-1 min-w-0" style={{ colorScheme: 'dark' }} />
          )}
          <button onClick={handleSend} className="p-1.5 bg-fc-accent rounded-lg text-white hover:bg-fc-accent/80 flex-shrink-0" title="Envoyer">
            <Send size={14} />
          </button>
          <button onClick={handleCancel} className="p-1.5 bg-fc-hover rounded-lg text-fc-muted hover:text-white flex-shrink-0" title="Annuler">
            <X size={14} />
          </button>
        </>
      )}
    </div>
  )
}
