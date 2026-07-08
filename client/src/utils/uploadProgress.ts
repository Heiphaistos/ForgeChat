import toast from 'react-hot-toast'
import api from '../api/client'

// En dessous de ce seuil l'upload est quasi instantané : pas de toast pour éviter le flash
const PROGRESS_THRESHOLD = 512 * 1024

// Avertir avant de fermer/rafraîchir l'onglet tant qu'un upload est en cours
let activeUploads = 0
const warnBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
function trackUpload(delta: 1 | -1) {
  const wasZero = activeUploads === 0
  activeUploads = Math.max(0, activeUploads + delta)
  if (wasZero && activeUploads > 0) window.addEventListener('beforeunload', warnBeforeUnload)
  if (activeUploads === 0) window.removeEventListener('beforeunload', warnBeforeUnload)
}

/** POST multipart avec toast de progression pour les gros fichiers (mobile / connexions lentes). */
export async function postWithUploadProgress(url: string, fd: FormData, totalBytes: number) {
  trackUpload(1)
  try {
    if (totalBytes < PROGRESS_THRESHOLD) {
      try {
        return await api.post(url, fd)
      } catch (err: any) {
        toast.error(err?.response?.data?.error ?? "Échec de l'envoi du fichier")
        throw err
      }
    }
    const tid = toast.loading('Envoi du fichier… 0%')
    try {
      const res = await api.post(url, fd, {
        onUploadProgress: e => {
          if (e.total) {
            const pct = Math.min(100, Math.round((e.loaded / e.total) * 100))
            toast.loading(`Envoi du fichier… ${pct}%`, { id: tid })
          }
        },
      })
      toast.success('Fichier envoyé', { id: tid })
      return res
    } catch (err: any) {
      // Message serveur si disponible (type refusé, taille, permission...)
      toast.error(err?.response?.data?.error ?? "Échec de l'envoi du fichier", { id: tid })
      throw err
    }
  } finally {
    trackUpload(-1)
  }
}
