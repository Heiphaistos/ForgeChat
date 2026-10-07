// Vidéo d'appel en plein écran (appels privés, de groupe, salons vocaux) : vrai plein écran
// (Fullscreen API) quand le navigateur l'accorde, sinon calque sur toute la fenêtre (application
// de bureau) ; Échap, double-clic ou bouton pour sortir ; bascule remplir / ajuster.
import { useEffect, useRef, useState } from 'react'
import { Expand, Shrink, X } from 'lucide-react'
import NativeVideo from './NativeVideo'
import { useT } from '../../i18n'

export interface FullscreenSource { stream?: MediaStream | null; url?: string | null; label: string }

export default function FullscreenVideo({ stream = null, url = null, label, onClose }: FullscreenSource & { onClose: () => void }) {
  const t = useT()
  const box = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState<'contain' | 'cover'>('contain')
  // Dernier onClose sans relancer l'effet (les appelants passent une fonction fléchée).
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose }, [onClose])

  useEffect(() => {
    const el = box.current
    if (!el) return
    let entered = false
    el.requestFullscreen?.().then(() => { entered = true }).catch(() => { /* refusé : calque plein fenêtre */ })
    // Sortie par Échap ou par le navigateur : fermer aussi le calque.
    const onChange = () => { if (entered && !document.fullscreenElement) close.current() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.fullscreenElement) close.current() }
    document.addEventListener('fullscreenchange', onChange)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      window.removeEventListener('keydown', onKey)
      if (document.fullscreenElement === el) void document.exitFullscreen().catch(() => {})
    }
  }, [])

  // `muted` obligatoire : le son est joué ailleurs (PersistentVoiceAudio / PersistentDmCallAudio) ;
  // agrandir sa propre tuile rejouerait le micro (larsen), celle d'un pair doublerait sa voix.
  const attach = (el: HTMLVideoElement | null) => {
    if (el && stream && el.srcObject !== stream) el.srcObject = stream
  }
  const objectFit = fit === 'cover' ? 'object-cover' : 'object-contain'

  return (
    // Événements arrêtés ici : rendue dans une tuile, la visionneuse ne doit pas déclencher ses actions.
    <div ref={box} className="fixed inset-0 z-50 bg-black flex flex-col" role="dialog" aria-label={label}
      onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
      <div className="flex items-center gap-2 px-4 py-2 bg-black/60">
        <span className="flex-1 min-w-0 truncate text-white font-semibold text-sm">{label}</span>
        <button onClick={() => setFit(fit === 'cover' ? 'contain' : 'cover')} aria-pressed={fit === 'cover'}
          aria-label={t(fit === 'cover' ? 'voice.fullscreen.fit' : 'voice.fullscreen.fill')} title={t(fit === 'cover' ? 'voice.fullscreen.fit' : 'voice.fullscreen.fill')}
          className="p-1.5 rounded hover:bg-white/10 text-white min-w-[36px] min-h-[36px] flex items-center justify-center">
          {fit === 'cover' ? <Shrink size={18} aria-hidden /> : <Expand size={18} aria-hidden />}
        </button>
        <button onClick={onClose} aria-label={t('voice.closeFullscreen')} title={t('voice.closeFullscreen')}
          className="p-1.5 rounded hover:bg-white/10 text-white min-w-[36px] min-h-[36px] flex items-center justify-center">
          <X size={18} aria-hidden />
        </button>
      </div>
      <div className="flex-1 min-h-0" onDoubleClick={onClose}>
        {url && !stream
          ? <NativeVideo url={url} fit={fit} className="w-full h-full" />
          : <video ref={attach} autoPlay playsInline muted className={`w-full h-full ${objectFit}`} />}
      </div>
    </div>
  )
}
