import { useEffect, useRef, useState } from 'react'
import { Camera, X } from 'lucide-react'
import { useVoice } from '../../store/voice'
import { useAvPrefs, camConstraintsFromPrefs } from '../../lib/avPrefs'
import { maybeBlur } from '../../utils/backgroundBlur'
import { useT } from '../../i18n'

/**
 * Aperçu avant d'allumer la caméra en salon vocal (Réglages > Vidéo > Toujours
 * prévisualiser) : on se voit tel que les autres nous verront (fond virtuel et
 * réglages d'image compris) avant que rien ne soit diffusé.
 */
export default function CameraPreviewDialog() {
  const t = useT()
  const open = useVoice(s => s.cameraPreview)
  const mirror = useAvPrefs(s => s.camMirror)
  const setPref = useAvPrefs(s => s.set)
  const always = useAvPrefs(s => s.camAlwaysPreview)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    let tracks: MediaStreamTrack[] = []
    setFailed(false)
    navigator.mediaDevices.getUserMedia({ video: camConstraintsFromPrefs() })
      .then(async s => {
        const raw = s.getVideoTracks()[0]
        const shown = raw ? await maybeBlur(raw) : null
        tracks = shown ? [shown] : s.getTracks()
        if (cancelled) { tracks.forEach(tr => tr.stop()); return }
        setStream(shown ? new MediaStream([shown]) : s)
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => {
      cancelled = true
      tracks.forEach(tr => tr.stop())
      setStream(null)
    }
  }, [open])

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream
  }, [stream])

  if (!open) return null

  const close = () => useVoice.getState().closeCameraPreview()
  // L'aperçu libère la caméra avant que l'appel ne la rouvre (sinon deux captures).
  const start = () => {
    stream?.getTracks().forEach(tr => tr.stop())
    setStream(null)
    void useVoice.getState().toggleVideo({ skipPreview: true })
  }

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={t('av.preview.title')}
      onKeyDown={e => { if (e.key === 'Escape') close() }}>
      <div className="w-full max-w-lg rounded-xl bg-fc-sidebar border border-fc-hover shadow-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">{t('av.preview.title')}</h2>
          <button onClick={close} className="p-1 rounded hover:bg-fc-hover text-fc-muted" aria-label={t('av.preview.cancel')}><X size={16} /></button>
        </div>
        <div className="relative aspect-video bg-black rounded-lg overflow-hidden flex items-center justify-center">
          {failed
            ? <span className="text-xs text-fc-red px-4 text-center">{t('av.preview.failed')}</span>
            : stream
              ? <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" style={mirror ? { transform: 'scaleX(-1)' } : undefined} />
              : <Camera size={32} className="text-fc-muted opacity-40" />}
        </div>
        <label className="flex items-center gap-2 text-xs text-fc-muted cursor-pointer">
          <input type="checkbox" checked={always} onChange={e => setPref('camAlwaysPreview', e.target.checked)} className="accent-fc-accent" />
          {t('av.video.alwaysPreview')}
        </label>
        <div className="flex justify-end gap-2">
          <button onClick={close} className="px-3 py-1.5 rounded-lg text-sm text-white bg-fc-hover hover:opacity-80">{t('av.preview.cancel')}</button>
          <button onClick={start} disabled={failed} autoFocus className="px-3 py-1.5 rounded-lg text-sm text-white bg-fc-accent hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5">
            <Camera size={14} /> {t('av.preview.start')}
          </button>
        </div>
      </div>
    </div>
  )
}
