import toast from 'react-hot-toast'
import api from '../api/client'

// En dessous de ce seuil l'upload est quasi instantané : pas de toast pour éviter le flash
const PROGRESS_THRESHOLD = 512 * 1024

/** POST multipart avec toast de progression pour les gros fichiers (mobile / connexions lentes). */
export async function postWithUploadProgress(url: string, fd: FormData, totalBytes: number) {
  if (totalBytes < PROGRESS_THRESHOLD) return api.post(url, fd)
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
  } catch (err) {
    toast.error("Échec de l'envoi du fichier", { id: tid })
    throw err
  }
}
