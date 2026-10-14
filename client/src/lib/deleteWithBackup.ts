import toast from 'react-hot-toast'
import { t as tr } from '../i18n'
import api from '../api/client'
import { confirmChoice } from '../components/ui/ConfirmModal'
import { saveFile } from './saveFile'

interface Target {
  kind: 'channel' | 'category'
  serverId: string
  serverName?: string
  id: string
  name: string
}

const slug = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x'

/**
 * Confirmation à trois choix avant suppression d'un salon ou d'une catégorie :
 * « Sauvegarder puis supprimer » (JSON téléchargé, suppression seulement si la
 * sauvegarde a réussi), « Supprimer sans sauvegarde », « Annuler ».
 * Renvoie `true` si l'élément a été supprimé.
 */
export async function deleteWithBackup(t: Target): Promise<boolean> {
  const isCat = t.kind === 'category'
  const choice = await confirmChoice({
    title: isCat ? tr('sw.del.titleCat', { name: t.name }) : tr('sw.del.titleCh', { name: t.name }),
    message: isCat
      ? tr('sw.del.msgCat')
      : tr('sw.del.msgCh'),
    danger: true,
    altLabel: tr('sw.del.backupThen'),
    confirmLabel: tr('sw.del.noBackup'),
  })
  if (choice === 'cancel') return false

  if (choice === 'alt') {
    try {
      const url = isCat ? `/servers/${t.serverId}/categories/${t.id}/backup` : `/channels/${t.id}/backup`
      const { data } = await api.get(url)
      const date = new Date().toISOString().slice(0, 10)
      const name = `forgechat-${slug(t.serverName ?? 'serveur')}-${slug(t.name)}-${date}.json`
      // Annulé ou échec d'écriture : rien n'est supprimé.
      if (!await saveFile(JSON.stringify(data, null, 2), name, 'application/json')) return false
      if (data?.truncated || data?.channels?.some((c: any) => c?.truncated)) {
        toast(tr('hc.t.backupLimit'))
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? tr('sw.del.backupFail'))
      return false
    }
  }

  try {
    await api.delete(isCat ? `/servers/${t.serverId}/categories/${t.id}` : `/servers/${t.serverId}/channels/${t.id}`)
    return true
  } catch (e: any) {
    toast.error(e?.response?.data?.error ?? tr('sw.del.fail'))
    return false
  }
}
