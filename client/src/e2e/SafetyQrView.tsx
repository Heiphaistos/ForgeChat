// Code de sécurité en QR code (amélioration n° 11) : affichage, et scan par la caméra quand le
// navigateur sait lire les QR (BarcodeDetector). Sinon, l'autre personne scanne ce QR avec
// l'appli mobile, ou l'on compare les chiffres.
import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { useT } from '../i18n'
import { compareSafetyScan, safetyPayload, type SafetyScan } from './safetyQr'

interface Detector { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> }
type DetectorCtor = new (o: { formats: string[] }) => Detector

const detectorCtor = (): DetectorCtor | null =>
  (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector ?? null

export function SafetyQrImage({ code }: { code: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    QRCode.toDataURL(safetyPayload(code), { width: 200, margin: 1, errorCorrectionLevel: 'M' })
      .then(u => { if (alive) setSrc(u) }, () => {})
    return () => { alive = false }
  }, [code])
  return src ? <img src={src} alt="" className="w-40 h-40 bg-white p-2 rounded-lg" /> : null
}

/** Bouton « Scanner son code » puis vidéo de la caméra ; `onResult` reçoit la comparaison. */
export function SafetyQrScanner({ code, onResult }: { code: string; onResult: (r: SafetyScan) => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const Ctor = detectorCtor()
  // Rappel lu au moment du résultat : un nouveau rendu du parent ne relance pas la caméra.
  const result = useRef(onResult)
  useEffect(() => { result.current = onResult }, [onResult])

  useEffect(() => {
    if (!open || !Ctor) return
    let stream: MediaStream | null = null
    let timer: number | undefined
    let stopped = false
    const detector = new Ctor({ formats: ['qr_code'] })
    const stop = () => {
      stopped = true
      if (timer) window.clearTimeout(timer)
      stream?.getTracks().forEach(tr => tr.stop())
    }
    const tick = async () => {
      if (stopped || !video.current) return
      try {
        const found = await detector.detect(video.current)
        const text = found.find(f => f.rawValue.startsWith('FCSAFE1:'))?.rawValue
        if (text) {
          stop()
          setOpen(false)
          result.current(compareSafetyScan(text, code))
          return
        }
      } catch { /* image pas encore prête */ }
      timer = window.setTimeout(tick, 250)
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(s => {
        stream = s
        if (stopped) return stop()
        if (video.current) { video.current.srcObject = s; void video.current.play() }
        void tick()
      })
      .catch(() => { setOpen(false); result.current('invalid') })
    return stop
  }, [open, Ctor, code])

  if (!Ctor) return null
  return open ? (
    <div className="mt-2 space-y-2">
      <video ref={video} muted playsInline className="w-full max-w-xs rounded-lg bg-black" />
      <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 text-xs bg-fc-hover text-white rounded-lg">
        {t('common.cancel')}
      </button>
    </div>
  ) : (
    <button type="button" onClick={() => setOpen(true)} className="mt-2 ml-2 px-3 py-1.5 text-xs bg-fc-hover text-white rounded-lg">
      {t('guard.qr.scan')}
    </button>
  )
}
