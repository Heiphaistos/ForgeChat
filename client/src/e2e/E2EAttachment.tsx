// Pièce jointe chiffrée de bout en bout (docs/CHIFFREMENT-E2E.md §12) : miniature du
// message tout de suite, fichier déchiffré sur l'appareil (d'office s'il est petit,
// à la demande sinon). Utilisé par les salons, fils, forums, MP et groupes.
import { useCallback, useEffect, useState } from 'react'
import { Download, FileText, Lock, Play } from 'lucide-react'
import { useT } from '../i18n'
import { formatBytes } from '../utils/compressImage'
import { safeMime } from './crypto'
import TranscribeButton from '../components/ai/TranscribeButton'
import SpeedAudio from '../components/chat/SpeedAudio'
import { AUTO_DECRYPT_MAX, decryptedBlob, decryptedUrl, saveDecrypted, thumbUrl, type DisplayAttachment } from './files'

type Kind = 'image' | 'video' | 'audio' | 'file'
const kindOf = (m: string): Kind => {
  const t = safeMime(m)
  return t.startsWith('image/') ? 'image' : t.startsWith('video/') ? 'video' : t.startsWith('audio/') ? 'audio' : 'file'
}

interface Props {
  att: DisplayAttachment
  /** Image déchiffrée cliquée (visionneuse de l'écran appelant). */
  onOpen?: (src: string) => void
  /** Classe des images et vidéos (taille propre à chaque écran). */
  mediaClass?: string
}

export default function E2EAttachment({ att, onOpen, mediaClass = 'max-w-full sm:max-w-sm max-h-72 rounded' }: Props) {
  const t = useT()
  const e = att.e2e
  const [src, setSrc] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const kind = e ? kindOf(e.m) : 'file'

  const load = useCallback(async () => {
    if (!e) return null
    setState('loading')
    try {
      const url = await decryptedUrl(att.url, e)
      setSrc(url)
      setState('idle')
      return url
    } catch {
      setState('error')
      return null
    }
  }, [att.url, e])

  useEffect(() => {
    if (e && kind !== 'file' && e.s <= AUTO_DECRYPT_MAX) void load()
  }, [e, kind, load])

  if (!e) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded bg-fc-input text-xs text-fc-muted max-w-xs">
        <Lock size={14} aria-hidden /> {t('e2e.file.locked')}
      </div>
    )
  }
  if (state === 'error') {
    return <div className="px-3 py-2 rounded bg-fc-input text-xs text-red-400 max-w-xs">{t('e2e.file.broken', { name: e.n })}</div>
  }

  const thumb = thumbUrl(e)
  const size = formatBytes(e.s)
  const busy = state === 'loading'
  if (kind === 'image') {
    const shown = src ?? thumb
    return shown ? (
      <img
        src={shown}
        alt={e.n}
        width={e.w}
        height={e.h}
        className={`${mediaClass} object-cover ${src ? 'cursor-zoom-in' : 'blur-sm'}`}
        onClick={() => { if (src) onOpen?.(src); else void load() }}
      />
    ) : (
      <button type="button" onClick={() => void load()} disabled={busy} className="flex items-center gap-2 px-3 py-2 rounded bg-fc-input text-sm text-fc-accent">
        <Lock size={14} aria-hidden /> {busy ? t('e2e.file.decrypting') : t('e2e.file.show', { name: e.n, size })}
      </button>
    )
  }
  if (kind === 'video' && src) return <video src={src} controls playsInline className={mediaClass} style={{ background: '#111' }} />
  if (kind === 'audio' && src) return <div><SpeedAudio src={src} /><TranscribeButton load={() => decryptedBlob(att.url, e)} /></div>
  if (kind === 'video') {
    return (
      <button
        type="button"
        onClick={() => void load()}
        disabled={busy}
        aria-label={t('e2e.file.play', { name: e.n, size })}
        className={`relative flex items-center justify-center bg-black/70 text-white ${mediaClass}`}
        style={{ minWidth: 200, minHeight: 120 }}
      >
        {thumb && <img src={thumb} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60 rounded" />}
        <span className="relative flex items-center gap-2 text-xs font-medium bg-black/50 px-2 py-1 rounded">
          <Play size={14} aria-hidden /> {busy ? t('e2e.file.decrypting') : t('e2e.file.play', { name: e.n, size })}
        </span>
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={() => void saveDecrypted(att.url, e).catch(() => setState('error'))}
      className="flex items-center gap-2 bg-fc-input px-3 py-2 rounded max-w-full sm:max-w-xs hover:bg-fc-hover transition text-left"
      title={t('e2e.file.save')}
    >
      <FileText size={16} className="flex-shrink-0 text-fc-muted" aria-hidden />
      <span className="text-fc-accent text-sm truncate">{e.n}</span>
      <span className="text-xs text-fc-muted flex-shrink-0">{size}</span>
      <Lock size={12} className="flex-shrink-0 text-fc-muted" aria-label={t('e2e.file.encrypted')} />
      <Download size={14} className="flex-shrink-0 text-fc-muted" aria-hidden />
    </button>
  )
}
