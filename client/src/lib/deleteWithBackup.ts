import toast from 'react-hot-toast'
import api from '../api/client'
import { confirmChoice } from '../components/ui/ConfirmModal'

interface Target {
  kind: 'channel' | 'category'
  serverId: string
  serverName?: string
  id: string
  name: string
}

const slug = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x'

function downloadJson(data: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  // Ancre dans le DOM : sinon Firefox ne télécharge rien.
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * Confirmation à trois choix avant suppression d'un salon ou d'une catégorie :
 * « Sauvegarder puis supprimer » (JSON téléchargé, suppression seulement si la
 * sauvegarde a réussi), « Supprimer sans sauvegarde », « Annuler ».
 * Renvoie `true` si l'élément a été supprimé.
 */
export async function deleteWithBackup(t: Target): Promise<boolean> {
  const isCat = t.kind === 'category'
  const choice = await confirmChoice({
    title: isCat ? `Supprimer la catégorie « ${t.name} » ?` : `Supprimer #${t.name} ?`,
    message: isCat
      ? 'Ses salons seront détachés (pas supprimés). Vous pouvez d’abord télécharger une sauvegarde JSON de la catégorie et de ses salons.'
      : 'Messages, épingles et réglages seront perdus. Vous pouvez d’abord télécharger une sauvegarde JSON du salon.',
    danger: true,
    altLabel: 'Sauvegarder puis supprimer',
    confirmLabel: 'Supprimer sans sauvegarde',
  })
  if (choice === 'cancel') return false

  if (choice === 'alt') {
    try {
      const url = isCat ? `/servers/${t.serverId}/categories/${t.id}/backup` : `/channels/${t.id}/backup`
      const { data } = await api.get(url)
      const date = new Date().toISOString().slice(0, 10)
      downloadJson(data, `forgechat-${slug(t.serverName ?? 'serveur')}-${slug(t.name)}-${date}.json`)
      if (data?.truncated || data?.channels?.some((c: any) => c?.truncated)) {
        toast('Sauvegarde limitée aux 50 000 derniers messages par salon.')
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Sauvegarde impossible : rien n’a été supprimé.')
      return false
    }
  }

  try {
    await api.delete(isCat ? `/servers/${t.serverId}/categories/${t.id}` : `/servers/${t.serverId}/channels/${t.id}`)
    return true
  } catch (e: any) {
    toast.error(e?.response?.data?.error ?? 'Erreur lors de la suppression')
    return false
  }
}
