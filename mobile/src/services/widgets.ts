import { requireOptionalNativeModule } from 'expo'
import { AppState, Platform } from 'react-native'
import { flattenNewestFirst, messagesKey, type MessagesData } from '@/features/chat/cache'
import { t } from '@/i18n'
import { qk, queryClient } from '@/lib/queryClient'
import { useAuth } from '@/stores/auth'
import { useLock } from '@/stores/lock'
import { useSettings } from '@/stores/settings'
import { useUnread } from '@/stores/unread'
import { useVoiceRooms, type VoiceRoomMember } from '@/stores/voiceRooms'
import type { Channel, ConversationSummary } from '@/types/models'

/**
 * Widgets Android « Derniers messages » et « En vocal » (modules/call-service, ForgeWidgets.kt).
 * Le texte est préparé ici. Le contenu des messages (déchiffré sur l'appareil) n'y figure que si
 * l'option « Afficher le contenu dans le widget » est activée (désactivée par défaut) ET que
 * l'appli est déverrouillée et au premier plan quand le verrouillage est actif ; sinon seulement
 * les noms des conversations et le nombre de messages non lus.
 */

const native = Platform.OS === 'android'
  ? requireOptionalNativeModule<{ updateWidgets(mt: string, mb: string, vt: string, vb: string): void }>('ForgeCallService')
  : null

export interface WidgetConversation { name: string; unread: number; lastText: string | null }
export interface WidgetRoom { channel: string; members: string[] }

const MAX_LINES = 6

/** Texte des deux widgets (fonction pure, testée). `reveal` : contenu des messages permis. */
export function buildWidgetText(convs: WidgetConversation[], unreadChannels: number, rooms: WidgetRoom[], reveal: boolean) {
  const lines = convs.slice(0, MAX_LINES).map((c) => {
    const detail = reveal && c.lastText
      ? c.lastText.replace(/\s+/g, ' ').slice(0, 80)
      : c.unread > 0 ? t('widget.unread', { n: c.unread }) : ''
    return detail ? `${c.name} : ${detail}` : c.name
  })
  if (unreadChannels > 0) lines.push(t('widget.channels', { n: unreadChannels }))
  const occupied = rooms.filter((r) => r.members.length > 0)
  const people = occupied.reduce((n, r) => n + r.members.length, 0)
  return {
    messagesTitle: t('widget.messagesTitle'),
    messagesBody: lines.length ? lines.join('\n') : t('widget.noMessages'),
    voiceTitle: people ? t('widget.voiceTitleCount', { n: people }) : t('widget.voiceTitle'),
    voiceBody: occupied.length
      ? occupied.slice(0, MAX_LINES).map((r) => `#${r.channel} : ${r.members.slice(0, 4).join(', ')}${r.members.length > 4 ? '…' : ''}`).join('\n')
      : t('widget.nobody'),
  }
}

function channelName(id: string): string {
  for (const [, list] of queryClient.getQueriesData<Channel[]>({ queryKey: ['channels'] })) {
    const ch = Array.isArray(list) ? list.find((c) => c.id === id) : undefined
    if (ch) return ch.name
  }
  return '…'
}

function collect() {
  const { counts, serverOf } = useUnread.getState()
  const convs = (queryClient.getQueryData<ConversationSummary[]>(qk.conversations) ?? [])
    .filter((c) => !c.is_archived)
    .slice()
    .sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''))
    .map((c): WidgetConversation => {
      const kind = c.is_group ? 'group' : 'dm'
      const last = flattenNewestFirst(queryClient.getQueryData<MessagesData>(messagesKey(kind, c.id)))[0]
      return { name: c.is_group ? c.name : c.username, unread: counts[c.id] ?? 0, lastText: last?.content ?? null }
    })
  const unreadChannels = Object.keys(counts).filter((id) => serverOf[id] && (counts[id] ?? 0) > 0).length
  const rooms = Object.entries(useVoiceRooms.getState().rooms).map(([id, members]: [string, VoiceRoomMember[]]) => ({
    channel: channelName(id),
    members: members.map((m) => m.username),
  }))
  const { widgetShowContent, appLock } = useSettings.getState()
  const reveal = widgetShowContent && !useLock.getState().locked && (!appLock || AppState.currentState === 'active')
  return buildWidgetText(convs, unreadChannels, rooms, reveal)
}

function render() {
  if (!native) return
  try {
    if (useAuth.getState().status !== 'signedIn') {
      native.updateWidgets(t('widget.messagesTitle'), t('widget.signedOut'), t('widget.voiceTitle'), t('widget.signedOut'))
      return
    }
    const w = collect()
    native.updateWidgets(w.messagesTitle, w.messagesBody, w.voiceTitle, w.voiceBody)
  } catch { /* ancien binaire sans widgets : sans conséquence */ }
}

let timer: ReturnType<typeof setTimeout> | null = null
function schedule() {
  if (!native || timer) return
  timer = setTimeout(() => {
    timer = null
    render()
  }, 1500)
}

/** Met les widgets à jour quand les non-lus, le vocal, le verrou ou les conversations changent. */
export function bindWidgets(): () => void {
  if (!native) return () => undefined
  const offs = [
    useUnread.subscribe(schedule),
    useVoiceRooms.subscribe(schedule),
    useLock.subscribe(schedule),
    useSettings.subscribe(schedule),
    useAuth.subscribe(schedule),
    queryClient.getQueryCache().subscribe((e) => {
      const k = e.query.queryKey[0]
      if (k === 'conversations' || k === 'messages') schedule()
    }),
  ]
  // Passage en arrière-plan : contenu retiré tout de suite si le verrouillage est actif.
  const app = AppState.addEventListener('change', (st) => (st === 'active' ? schedule() : render()))
  schedule()
  return () => {
    offs.forEach((off) => off())
    app.remove()
  }
}
