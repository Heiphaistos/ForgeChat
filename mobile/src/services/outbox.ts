import { Alert } from 'react-native'
import { errorCode, openBody, sealBody } from '@/e2e/conversations'
import type { EncPayload } from '@/e2e/crypto'
import { t } from '@/i18n'
import { ApiError, http } from '@/lib/http'
import { convOf, flushOutbox, type OutboxItem, type SendResult } from '@/lib/offline'
import { queryClient } from '@/lib/queryClient'
import { realtime } from '@/lib/realtime'
import { getMyId } from '@/stores/auth'

/** Envoie un message de la file ; rechiffré si la clé de la conversation a changé entre-temps. */
async function sendQueued(it: OutboxItem): Promise<SendResult> {
  try {
    await http.post(it.path, it.body, { noQueue: true })
    return 'ok'
  } catch (e) {
    if (!(e instanceof ApiError) || e.isNetwork) return 'retry'
    const conv = convOf(it.path)
    const me = getMyId()
    if (errorCode(e) === 'EPOCH_STALE' && conv && me) {
      const cmid = String(it.body.client_msg_id ?? '')
      const plain = await openBody(conv[0], conv[1], it.body.enc as EncPayload, me, cmid)
      if (!plain) return 'drop'
      const sealed = await sealBody(conv[0], conv[1], plain, { clientMsgId: cmid })
      return http.post(it.path, { ...it.body, ...sealed }, { noQueue: true }).then(() => 'ok' as const, () => 'drop' as const)
    }
    return e.status === 429 || e.status >= 500 ? 'retry' : 'drop'
  }
}

export async function sendOutbox() {
  const { sent, dropped } = await flushOutbox(sendQueued)
  if (sent > 0) void queryClient.invalidateQueries({ queryKey: ['messages'] })
  if (dropped > 0) Alert.alert(t('offline.droppedTitle'), t('offline.dropped', { n: dropped }))
}

/** Au retour du réseau (WebSocket rouvert) : la file part. */
export function bindOutbox(): () => void {
  return realtime.onOpen(() => void sendOutbox())
}
