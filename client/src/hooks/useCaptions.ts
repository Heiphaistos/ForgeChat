import { useState, useRef, useCallback, useEffect } from 'react'

export interface CaptionEntry {
  id: number
  text: string
  isFinal: boolean
  timestamp: number
}

type SpeechRec = any

export function useCaptions() {
  const [isActive, setIsActive] = useState(false)
  const [captions, setCaptions] = useState<CaptionEntry[]>([])
  const [isSupported] = useState(
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
  )
  const recognitionRef = useRef<SpeechRec | null>(null)
  const entryIdRef = useRef(0)

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setIsActive(false)
  }, [])

  const start = useCallback((lang = 'fr-FR') => {
    if (!isSupported) return
    stop()

    const SpeechRec =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const rec: SpeechRec = new SpeechRec()
    rec.lang = lang
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1

    rec.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0].transcript.trim()
        if (!text) continue

        if (result.isFinal) {
          setCaptions(prev => {
            const withoutInterim = prev.filter(c => c.isFinal)
            return [
              ...withoutInterim.slice(-4),
              { id: entryIdRef.current++, text, isFinal: true, timestamp: Date.now() },
            ]
          })
        } else {
          setCaptions(prev => {
            const finals = prev.filter(c => c.isFinal)
            return [
              ...finals,
              { id: -1, text, isFinal: false, timestamp: Date.now() },
            ]
          })
        }
      }
    }

    rec.onerror = () => { setIsActive(false) }
    rec.onend = () => {
      // Redémarrer automatiquement si toujours actif
      if (recognitionRef.current === rec) {
        try { rec.start() } catch { setIsActive(false) }
      }
    }

    recognitionRef.current = rec
    rec.start()
    setIsActive(true)
  }, [isSupported, stop])

  const toggle = useCallback((lang?: string) => {
    if (isActive) stop()
    else start(lang)
  }, [isActive, start, stop])

  const clear = useCallback(() => setCaptions([]), [])

  useEffect(() => () => { stop() }, [stop])

  return { isActive, isSupported, captions, start, stop, toggle, clear }
}
