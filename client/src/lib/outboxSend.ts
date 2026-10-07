import toast from 'react-hot-toast'
import api from '../api/client'
import { errorCode, openBody, sealBody } from '../e2e/conversations'
import type { EncPayload } from '../e2e/crypto'
import { queryClient } from '../main'
import { convOf, flushOutbox, type OutboxItem, type SendResult } from './offline'
import { t } from '../i18n'

const post = (url: string, body: unknown) => api.post(url, body, { fcNoQueue: true } as object)

/** Envoi d'un message mis en file ; rechiffré si la clé de la conversation a changé entre-temps. */
async function sendQueued(it: OutboxItem): Promise<SendResult> {
  try {
    await post(it.url, it.body)
    return 'ok'
  } catch (e) {
    const status = (e as { response?: { status?: number } }).response?.status
    if (!status) return 'retry'
    const conv = convOf(it.url)
    const me = it.owner
    if (errorCode(e) === 'EPOCH_STALE' && conv) {
      const cmid = String(it.body.client_msg_id ?? '')
      const plain = await openBody(conv[0], conv[1], it.body.enc as EncPayload, me, cmid)
      if (!plain) return 'drop'
      const sealed = await sealBody(conv[0], conv[1], plain, { clientMsgId: cmid })
      return post(it.url, { ...it.body, ...sealed }).then(() => 'ok' as const, () => 'drop' as const)
    }
    return status === 429 || status >= 500 ? 'retry' : 'drop'
  }
}

/** Au retour du réseau : envoie la file, rafraîchit les conversations. */
export async function sendOutbox() {
  const { sent, dropped } = await flushOutbox(sendQueued)
  if (sent > 0) {
    void queryClient.invalidateQueries({ queryKey: ['messages'] })
    void queryClient.invalidateQueries({ queryKey: ['dm_messages'] })
    void queryClient.invalidateQueries({ queryKey: ['group-dm-messages'] })
    toast.success(t('offline.sent', { n: sent }))
  }
  if (dropped > 0) toast.error(t('offline.dropped', { n: dropped }))
}
