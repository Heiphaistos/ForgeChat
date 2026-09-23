// Pièces jointes des fils et des réponses de forum : sélection des fichiers
// avant envoi, upload vers l'endpoint dédié, rendu des pièces jointes reçues.
// Même table et mêmes validations serveur que les messages de salon.
import { useState } from 'react'
import { FileText, X } from 'lucide-react'
import { mediaUrl } from '../../api/client'
import { postWithUploadProgress } from '../../utils/uploadProgress'

export interface SimpleAttachment {
  id: string
  url: string
  filename: string
  content_type: string
  size: number
}

// Plafond côté client : au-delà, l'envoi groupé devient une mauvaise surprise
const MAX_PENDING = 10

function formatSize(n: number) {
  if (n < 1024) return `${n} o`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`
  return `${(n / 1024 / 1024).toFixed(1)} Mo`
}

/** Fichiers choisis dans le composer, envoyés après la création du message. */
export function usePendingFiles() {
  const [files, setFiles] = useState<File[]>([])
  const add = (list: Iterable<File> | null | undefined) => {
    if (!list) return
    const incoming = Array.from(list)
    if (incoming.length === 0) return
    setFiles(cur => [...cur, ...incoming].slice(0, MAX_PENDING))
  }
  const pick = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.onchange = () => add(input.files)
    input.click()
  }
  const onPaste = (e: React.ClipboardEvent) => {
    const pasted = Array.from(e.clipboardData?.items ?? [])
      .filter(i => i.kind === 'file')
      .map(i => i.getAsFile())
      .filter((f): f is File => !!f)
    if (pasted.length === 0) return
    e.preventDefault()
    add(pasted)
  }
  const onDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer?.files?.length) return
    e.preventDefault()
    add(e.dataTransfer.files)
  }
  const onDragOver = (e: React.DragEvent) => {
    if (Array.from(e.dataTransfer?.items ?? []).some(i => i.kind === 'file')) e.preventDefault()
  }
  const remove = (idx: number) => setFiles(cur => cur.filter((_, i) => i !== idx))
  const clear = () => setFiles([])
  return { files, pick, onPaste, onDrop, onDragOver, remove, clear }
}

/** Envoie les fichiers vers `url` (multipart `files`). Les erreurs sont notifiées par l'utilitaire. */
export async function uploadPendingFiles(url: string, files: File[]) {
  if (files.length === 0) return
  const fd = new FormData()
  let total = 0
  for (const f of files) { fd.append('files', f); total += f.size }
  await postWithUploadProgress(url, fd, total)
}

export function PendingFiles({ files, onRemove }: { files: File[]; onRemove: (idx: number) => void }) {
  if (files.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5 mb-2" aria-label="Fichiers à joindre">
      {files.map((f, i) => (
        <span key={`${f.name}-${i}`} className="flex items-center gap-1 max-w-[180px] px-2 py-1 rounded bg-fc-hover text-xs text-fc-text">
          <FileText size={12} className="flex-shrink-0 text-fc-muted" aria-hidden />
          <span className="truncate" title={f.name}>{f.name}</span>
          <button
            type="button"
            onClick={() => onRemove(i)}
            aria-label={`Retirer ${f.name}`}
            className="flex-shrink-0 text-fc-muted hover:text-white"
          ><X size={12} aria-hidden /></button>
        </span>
      ))}
    </div>
  )
}

export function AttachmentList({ attachments }: { attachments?: SimpleAttachment[] }) {
  if (!attachments?.length) return null
  return (
    <div className="flex flex-col gap-1.5 mt-1.5">
      {attachments.map(att => {
        const src = mediaUrl(att.url)
        if (att.content_type.startsWith('image/')) {
          return (
            <a key={att.id} href={src} target="_blank" rel="noopener noreferrer" className="inline-block max-w-full">
              <img src={src} alt={att.filename} loading="lazy" decoding="async" className="max-w-full max-h-60 rounded object-cover" />
            </a>
          )
        }
        if (att.content_type.startsWith('video/')) {
          return <video key={att.id} src={src} controls playsInline preload="metadata" className="max-w-full max-h-60 rounded bg-black" />
        }
        if (att.content_type.startsWith('audio/')) {
          return <audio key={att.id} src={src} controls preload="metadata" className="max-w-full" />
        }
        return (
          <a
            key={att.id}
            href={src}
            download={att.filename}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 max-w-xs px-2.5 py-2 rounded bg-fc-hover/60 hover:bg-fc-hover text-xs text-fc-text transition"
          >
            <FileText size={16} className="flex-shrink-0 text-fc-muted" aria-hidden />
            <span className="truncate flex-1">{att.filename}</span>
            <span className="text-fc-muted flex-shrink-0">{formatSize(att.size)}</span>
          </a>
        )
      })}
    </div>
  )
}
