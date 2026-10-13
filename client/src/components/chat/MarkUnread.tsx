// « Marquer comme non lu » : la lecture repart juste avant ce message (salon, MP ou groupe).
// Le serveur renvoie les compteurs du salon, appliqués tels quels ; READ_STATE_UPDATE
// `{unread: true}` fait de même sur les autres appareils (App.tsx → useUnread.applyUnread).
import { EyeOff } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../api/client'
import { useUnread } from '../../store/unread'
import { t as tr, useT } from '../../i18n'
import { openGlobalMenu } from '../layout/DiscordFeatureHost'

/** `serverId` vide = conversation privée (MP 1:1 ou groupe, même route). */
export async function markUnread(serverId: string, channelId: string, messageId: string): Promise<void> {
  const url = serverId ? `/channels/${channelId}/unread` : `/dms/${channelId}/unread`
  try {
    const { data } = await api.post(url, { message_id: messageId })
    useUnread.getState().applyUnread({ ...data, unread: true, channel_id: channelId, server_id: serverId || null })
    toast.success(tr('dfeat.unread.done'))
  } catch (e) {
    console.warn('[mark-unread]', url, e)
    toast.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? tr('dfeat.unread.failed'))
  }
}

/** Entrée du menu contextuel d'un message (MessageList). */
export function MarkUnreadButton({ serverId, channelId, messageId, onDone }: { serverId: string; channelId: string; messageId: string; onDone: () => void }) {
  const t = useT()
  return (
    <button onClick={() => { void markUnread(serverId, channelId, messageId); onDone() }}
      className="flex items-center gap-2.5 w-full px-3 py-2.5 min-h-[44px] hover:bg-fc-hover transition text-fc-text">
      <EyeOff size={14} aria-hidden /> {t('dfeat.unread.mark')}
    </button>
  )
}

/** Menu contextuel réduit à « Marquer comme non lu » (écrans sans menu de message, ex. groupes). */
export function openMarkUnreadMenu(e: React.MouseEvent, serverId: string, channelId: string, messageId: string) {
  openGlobalMenu(e, [{ label: tr('dfeat.unread.mark'), onClick: () => void markUnread(serverId, channelId, messageId) }])
}
