// Réponse rapide et réactions depuis une notification de message (Android : RemoteInput).
// Le texte part TOUJOURS chiffré (messagesApi.send → withSeal, clé de compte exigée) :
// si la clé n'est pas prête, si l'envoi échoue ou si la réponse arrive après un
// redémarrage de l'appli, rien n'est envoyé : le texte devient le brouillon de la
// conversation et une notification propose de l'ouvrir.
import * as Notifications from 'expo-notifications'
import { router } from 'expo-router'
import { AppState } from 'react-native'
import { messagesApi } from '@/api/messages'
import { useAccountKey } from '@/e2e/accountKey'
import { useDrafts } from '@/e2e/drafts'
import { t } from '@/i18n'
import { logger } from '@/lib/logger'
import { useAuth } from '@/stores/auth'
import type { ConversationRef } from '@/types/models'
import { conversationId } from '@/features/chat/adapters'
import { actionFromIdentifier, MESSAGE_CATEGORY, refFromNotificationData, REPLY_ACTION, REACTION_ACTIONS } from '@/features/notifications/quickActions'

/** Réponse reçue juste après l'enregistrement de l'écouteur : faite appli fermée, envoyée trop tard. */
const LATE_WINDOW_MS = 3000

/** Boutons des notifications de message : répondre (champ de saisie) et deux réactions. */
export async function registerMessageCategory() {
  try {
    await Notifications.setNotificationCategoryAsync(MESSAGE_CATEGORY, [
      {
        identifier: REPLY_ACTION,
        buttonTitle: t('messaging.notif.reply'),
        textInput: { submitButtonTitle: t('messaging.notif.send'), placeholder: t('messaging.notif.placeholder') },
        options: { opensAppToForeground: false },
      },
      ...REACTION_ACTIONS.map((r) => ({ identifier: r.id, buttonTitle: r.emoji, options: { opensAppToForeground: false } })),
    ])
  } catch (e) {
    logger.warn('notif', 'catégorie', e)
  }
}

const route = (ref: ConversationRef) => {
  if (ref.kind === 'dm') return `/dm/${ref.dmId}`
  if (ref.kind === 'group') return `/group/${ref.groupId}`
  return `/channel/${ref.serverId}/${ref.channelId}`
}

/** Pas d'envoi : le texte devient le brouillon, et on propose d'ouvrir la conversation. */
async function openInstead(ref: ConversationRef, data: Record<string, unknown>, text: string | null) {
  if (text) useDrafts.getState().set(conversationId(ref), text)
  if (AppState.currentState === 'active') {
    router.push(route(ref) as never)
    return
  }
  await Notifications.scheduleNotificationAsync({
    content: { title: t('messaging.notif.notSentTitle'), body: t('messaging.notif.notSentBody'), data },
    trigger: null,
  }).catch((e) => logger.warn('notif', 'non envoyé', e))
}

async function dismiss(id: string) {
  await Notifications.dismissNotificationAsync(id).catch(() => undefined)
}

/** Dernier message des autres dans la conversation (notification sans identifiant de message). */
async function lastOthersMessage(ref: ConversationRef): Promise<string | null> {
  const me = useAuth.getState().user?.id
  const page = await messagesApi.list(ref)
  return [...page].reverse().find((m) => m.authorId !== me)?.id ?? null
}

/** Action d'une notification (hors simple toucher) ; `late` : reçue au redémarrage de l'appli. */
export async function handleMessageAction(resp: Notifications.NotificationResponse, late: boolean) {
  const action = actionFromIdentifier(resp.actionIdentifier)
  const data = (resp.notification.request.content.data ?? {}) as Record<string, unknown>
  const ref = refFromNotificationData(data)
  if (!action || !ref) return
  const notifId = resp.notification.request.identifier
  const ready = !late && useAuth.getState().status === 'signedIn' && useAccountKey.getState().status === 'ready'
  if (action.kind === 'reply') {
    const text = (resp.userText ?? '').trim().slice(0, 4000)
    await dismiss(notifId)
    if (!text) return
    if (!ready) return openInstead(ref, data, text)
    try {
      await messagesApi.send(ref, { content: text })
    } catch (e) {
      logger.warn('notif', 'réponse rapide', e)
      await openInstead(ref, data, text)
    }
    return
  }
  await dismiss(notifId)
  if (!ready) return openInstead(ref, data, null)
  try {
    const messageId = typeof data.message_id === 'string' ? data.message_id : await lastOthersMessage(ref)
    if (messageId) await messagesApi.react(ref, messageId, action.emoji, false)
  } catch (e) {
    logger.warn('notif', 'réaction', e)
  }
}

/** Écoute les actions des notifications ; le simple toucher reste géré par listenNotificationTaps. */
export function listenMessageActions(): () => void {
  const since = Date.now()
  const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
    if (resp.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) return
    void handleMessageAction(resp, Date.now() - since < LATE_WINDOW_MS)
  })
  return () => sub.remove()
}
