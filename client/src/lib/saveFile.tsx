// Enregistrement d'un fichier sur l'appareil, partagé par tous les « Télécharger »
// (pièces jointes, image de la visionneuse, export de conversation, sauvegardes).
// Web : téléchargement du navigateur. Bureau : boîte native « Enregistrer sous »
// (ou dossier par défaut, réglages Système) ouverte et écrite par Rust (systeme::save_file),
// puis toast « Enregistré dans … » avec « Ouvrir le dossier ».
import type React from 'react'
import toast from 'react-hot-toast'
import { t } from '../i18n'
import { desktopInvoke, errText, isDesktop } from './desktop'

export type SaveData = Blob | Uint8Array | string

function browserDownload(href: string, name: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = name
  a.rel = 'noopener'
  // Ancre dans le DOM : sinon Firefox ne télécharge rien.
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function savedToast(path: string) {
  toast(tt => (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="break-all">{t('save.savedIn', { path })}</span>
      <button
        type="button"
        className="self-start px-2 py-1 rounded bg-fc-accent text-white text-xs font-medium"
        onClick={() => {
          toast.dismiss(tt.id)
          void desktopInvoke('reveal_saved', { path }).catch(e => toast.error(t('save.failed', { e: errText(e) })))
        }}
      >
        {t('save.openFolder')}
      </button>
    </div>
  ), { duration: 8000 })
}

/**
 * Enregistre `data` sous le nom proposé. Renvoie false si l'utilisateur a annulé
 * ou si l'écriture a échoué (erreur déjà affichée).
 */
export async function saveFile(data: SaveData, name: string, mime = 'application/octet-stream'): Promise<boolean> {
  const blob = data instanceof Blob
    ? data
    : new Blob([data as BlobPart], { type: typeof data === 'string' ? `${mime};charset=utf-8` : mime })
  if (!isDesktop) {
    const url = URL.createObjectURL(blob)
    browserDownload(url, name)
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return true
  }
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const path = await desktopInvoke<string | null>('save_file', bytes, { 'x-file-name': encodeURIComponent(name) })
    if (!path) return false
    savedToast(path)
    return true
  } catch (e) {
    toast.error(t('save.failed', { e: errText(e) }))
    return false
  }
}

/** Fichier distant (pièce jointe non chiffrée, image) : lien du navigateur sur le web, octets sur le bureau. */
export async function saveUrl(url: string, name: string): Promise<boolean> {
  if (!isDesktop) {
    browserDownload(url, name)
    return true
  }
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await saveFile(await res.blob(), name)
  } catch (e) {
    toast.error(t('save.failed', { e: errText(e) }))
    return false
  }
}

/** `onClick` d'un lien `<a download>` : sur le bureau, passe par « Enregistrer sous ». */
export const desktopDownloadClick = (url: string | undefined, name: string) => (e: React.MouseEvent) => {
  if (!isDesktop || !url) return
  e.preventDefault()
  void saveUrl(url, name)
}
