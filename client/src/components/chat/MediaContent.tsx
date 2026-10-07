import { mediaUrl } from '../../api/client'
import { useCallback, useState } from 'react'
import LightboxModal from './LightboxModal'
import { renderMarkdown } from '../../utils/markdown'
import { postWithUploadProgress } from '../../utils/uploadProgress'
import { mustEncrypt } from '../../e2e/conversations'
import { blobName, type FileEntry } from '../../e2e/crypto'
import { sealFile, type DisplayAttachment } from '../../e2e/files'
import E2EAttachment from '../../e2e/E2EAttachment'

// Hook d'upload de média (image/vidéo) vers l'endpoint forum-uploads du canal,
// partagé entre forums et threads : picker fichier + collage presse-papier.
// Salon chiffré : le média est chiffré ici (blob opaque `.enc`), sa clé est
// gardée pour le contenu chiffré de la publication (`filesFor`, §12).
export function useMediaUpload(serverId: string, channelId: string) {
  const [uploading, setUploading] = useState(false)
  const [entries, setEntries] = useState<FileEntry[]>([])
  const uploadFile = async (f: File, onUrl: (url: string) => void) => {
    setUploading(true)
    try {
      const sealed = (await mustEncrypt('channel', channelId)) ? await sealFile(f) : null
      const fd = new FormData()
      if (sealed) fd.append('file', sealed.blob, blobName(sealed.entry.id))
      else fd.append('file', f)
      // Toast de progression pour les gros médias (vidéos jusqu'à 500 Mo) ; le
      // toast d'erreur (message serveur inclus) est géré par l'utilitaire
      const { data } = await postWithUploadProgress(`/servers/${serverId}/channels/${channelId}/forum-uploads`, fd, sealed?.blob.size ?? f.size)
      if (data?.url) {
        if (sealed) setEntries(list => [...list, { ...sealed.entry, u: data.url }])
        onUrl(data.url)
      }
    } catch {
      // déjà notifié par postWithUploadProgress
    } finally {
      setUploading(false)
    }
  }
  /** Contenu chiffré additionnel : médias chiffrés encore cités dans le texte ou la couverture. */
  const filesFor = useCallback((...texts: (string | null | undefined)[]) => {
    const used = entries.filter(e => texts.some(t => t?.includes(e.u!)))
    return used.length ? { f: used } : undefined
  }, [entries])
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
  return { pick, onPaste, onDrop, onDragOver, uploading, entries, filesFor }
}

/** Média chiffré cité par son adresse (couverture, contenu d'une publication). */
export function EncMedia({ url, files, className }: { url: string; files?: FileEntry[]; className?: string }) {
  const e = files?.find(f => f.u === url)
  const att: DisplayAttachment = e
    ? { id: e.id, url, filename: e.n, content_type: e.m, size: e.s, e2e: e }
    : { id: url, url, filename: '', content_type: 'application/octet-stream', size: 0, e2eLocked: true }
  return <E2EAttachment att={att} mediaClass={className} />
}

export const isEncUrl = (url: string | null | undefined) => !!url && /\.enc$/.test(url)

// Rendu de texte avec médias inline : les URLs /uploads/*.{img} deviennent des
// images cliquables (lightbox) et *.{vid} des lecteurs vidéo natifs.
// Utilisé par les forums et les threads (les messages classiques ont leurs
// attachments structurés).
const MEDIA_RE = /(\/uploads\/[\w.-]+\.(?:png|jpe?g|gif|webp|mp4|webm|mov|enc))/gi

/** `files` : médias chiffrés décrits dans le contenu chiffré (`.enc` dans le texte). */
export default function MediaContent({ text, className, files }: { text: string; className?: string; files?: FileEntry[] }) {
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
              key={i} src={mediaUrl(part)} alt="" loading="lazy" decoding="async"
              className="max-w-full md:max-w-sm rounded-lg my-1.5 block cursor-pointer hover:opacity-90 transition"
              onClick={() => setLightbox(imgIdx)}
            />
          )
        }
        if (part.startsWith('/uploads/') && isEncUrl(part)) {
          return <div key={i} className="my-1.5"><EncMedia url={part} files={files} className="max-w-full md:max-w-sm rounded-lg" /></div>
        }
        if (part.startsWith('/uploads/') && /\.(mp4|webm|mov)$/i.test(part)) {
          return <video key={i} src={mediaUrl(part)} controls playsInline preload="metadata" className="max-w-full md:max-w-sm rounded-lg my-1.5 block" />
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
