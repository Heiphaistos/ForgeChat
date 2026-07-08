import { useState } from 'react'
import LightboxModal from './LightboxModal'
import { renderMarkdown } from '../../utils/markdown'
import { postWithUploadProgress } from '../../utils/uploadProgress'

// Hook d'upload de média (image/vidéo) vers l'endpoint forum-uploads du canal,
// partagé entre forums et threads : picker fichier + collage presse-papier
export function useMediaUpload(serverId: string, channelId: string) {
  const [uploading, setUploading] = useState(false)
  const uploadFile = async (f: File, onUrl: (url: string) => void) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      // Toast de progression pour les gros médias (vidéos jusqu'à 50 Mo) ; le
      // toast d'erreur (message serveur inclus) est géré par l'utilitaire
      const { data } = await postWithUploadProgress(`/servers/${serverId}/channels/${channelId}/forum-uploads`, fd, f.size)
      if (data?.url) onUrl(data.url)
    } catch {
      // déjà notifié par postWithUploadProgress
    } finally {
      setUploading(false)
    }
  }
  const pick = (onUrl: (url: string) => void) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime'
    input.onchange = () => { const f = input.files?.[0]; if (f) uploadFile(f, onUrl) }
    input.click()
  }
  const onPaste = (e: React.ClipboardEvent, onUrl: (url: string) => void) => {
    const img = Array.from(e.clipboardData?.items ?? []).find(i => i.kind === 'file' && i.type.startsWith('image/'))
    if (!img) return
    e.preventDefault()
    const f = img.getAsFile()
    if (f) uploadFile(f, onUrl)
  }
  // Glisser-déposer un média sur le composer (image ou vidéo)
  const onDrop = (e: React.DragEvent, onUrl: (url: string) => void) => {
    const f = Array.from(e.dataTransfer?.files ?? []).find(f => f.type.startsWith('image/') || f.type.startsWith('video/'))
    if (!f) return
    e.preventDefault()
    uploadFile(f, onUrl)
  }
  const onDragOver = (e: React.DragEvent) => {
    if (Array.from(e.dataTransfer?.items ?? []).some(i => i.kind === 'file')) e.preventDefault()
  }
  return { pick, onPaste, onDrop, onDragOver, uploading }
}

// Rendu de texte avec médias inline : les URLs /uploads/*.{img} deviennent des
// images cliquables (lightbox) et *.{vid} des lecteurs vidéo natifs.
// Utilisé par les forums et les threads (les messages classiques ont leurs
// attachments structurés).
const MEDIA_RE = /(\/uploads\/[\w.-]+\.(?:png|jpe?g|gif|webp|mp4|webm|mov))/gi

export default function MediaContent({ text, className }: { text: string; className?: string }) {
  const parts = text.split(MEDIA_RE)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const images = parts.filter(p => p.startsWith('/uploads/') && /\.(png|jpe?g|gif|webp)$/i.test(p))
  return (
    <div className={className ?? 'text-sm text-fc-text leading-relaxed'}>
      {parts.map((part, i) => {
        if (part.startsWith('/uploads/') && /\.(png|jpe?g|gif|webp)$/i.test(part)) {
          const imgIdx = images.indexOf(part)
          return (
            <img
              key={i} src={part} alt="" loading="lazy" decoding="async"
              className="max-w-full md:max-w-sm rounded-lg my-1.5 block cursor-pointer hover:opacity-90 transition"
              onClick={() => setLightbox(imgIdx)}
            />
          )
        }
        if (part.startsWith('/uploads/') && /\.(mp4|webm|mov)$/i.test(part)) {
          return <video key={i} src={part} controls playsInline preload="metadata" className="max-w-full md:max-w-sm rounded-lg my-1.5 block" />
        }
        // Segment texte : markdown complet (gras, code, liens...) — renderMarkdown
        // gère lui-même les sauts de ligne, pas de whitespace-pre-wrap ici
        return part ? <span key={i}>{renderMarkdown(part)}</span> : null
      })}
      {lightbox !== null && (
        <LightboxModal images={images} initialIndex={lightbox} onClose={() => setLightbox(null)} />
      )}
    </div>
  )
}
