import { requireOptionalNativeModule } from 'expo'
import * as Notifications from 'expo-notifications'
import { AppRegistry, AppState, Platform } from 'react-native'
import { create } from 'zustand'
import { settingsApi, settingsKey, type ServerSideSettings } from '@/api/settings'
import { inQuietHours, keepConnectedEnabled, noticeFor, type LocalNotice } from '@/features/notifications/backgroundRules'
import { t } from '@/i18n'
import { logger } from '@/lib/logger'
import { qk, queryClient } from '@/lib/queryClient'
import { realtime, type RealtimeEvent } from '@/lib/realtime'
import { hasPushToken, setupNotificationChannels } from '@/services/push'
import { openRaw } from '@/e2e/conversations'
import { getMyId, registerSignOutHook, useAuth } from '@/stores/auth'
import { useCall } from '@/stores/call'
import { useGroupCall } from '@/stores/groupCall'
import { useSettings } from '@/stores/settings'
import { useVoice } from '@/stores/voice'
import type { ConversationSummary } from '@/types/models'

/**
 * Mode « Notifications sans Google » (Android, comme Signal sans Google Play) : sans Firebase, le push
 * serveur ne peut rien réveiller. Un service au premier plan natif (modules/call-service,
 * KeepAliveService) garde le processus en vie ; le WebSocket reste ouvert en arrière-plan
 * (services/lifecycle) et les messages qui le méritent (features/notifications/backgroundRules)
 * deviennent des notifications locales, touchées comme un push (routeFromNotification).
 */

/** Appel, appel de groupe ou salon vocal en cours (le WebSocket reste ouvert en arrière-plan). */
export const inCall = () => useCall.getState().phase !== 'idle' || !!useVoice.getState().channelId || !!useGroupCall.getState().groupId

export const useKeepAlive = create<{ active: boolean; hasPushToken: boolean }>(() => ({ active: false, hasPushToken: false }))

const native =
  Platform.OS === 'android' ? requireOptionalNativeModule<{ startKeepAlive(): void; stopKeepAlive(): void }>('ForgeCallService') : null

/** Tâche headless du service : minuteurs JS actifs en arrière-plan (comme ForgeChatKeepAlive, services/livekit). */
let endTask: (() => void) | null = null
if (native) {
  AppRegistry.registerHeadlessTask('ForgeChatNotifKeepAlive', () => () =>
    new Promise<void>((resolve) => {
      endTask?.()
      endTask = resolve
    }),
  )
}

function stop() {
  if (!useKeepAlive.getState().active) return
  native?.stopKeepAlive()
  endTask?.()
  endTask = null
  useKeepAlive.setState({ active: false })
}

async function apply() {
  if (!native) return
  const token = await hasPushToken()
  useKeepAlive.setState({ hasPushToken: token })
  const want = useAuth.getState().status === 'signedIn' && keepConnectedEnabled(useSettings.getState().keepConnected, token)
  if (!want) return stop()
  if (useKeepAlive.getState().active) return
  // Sans permission (Android 13+), ni la notification du service ni les messages ne s'afficheraient.
  let { status } = await Notifications.getPermissionsAsync()
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status
  if (status !== 'granted') return
  setupNotificationChannels()
  // Heures calmes : lues dans le cache par les règles, sans attendre l'ouverture des réglages.
  void queryClient.prefetchQuery({ queryKey: settingsKey, queryFn: settingsApi.get })
  native.startKeepAlive()
  useKeepAlive.setState({ active: true })
}

let queue: Promise<void> = Promise.resolve()
/** Démarre ou arrête le mode selon la session, le réglage et le jeton push. Appels en file. */
export function syncKeepAlive(): Promise<void> {
  queue = queue.then(apply).catch((e) => logger.warn('keepalive', 'démarrage', e))
  return queue
}

registerSignOutHook(() => stop())

function show(n: LocalNotice, channelId: 'messages' | 'calls') {
  Notifications.scheduleNotificationAsync({
    identifier: n.id,
    content: { title: n.title, body: n.body, data: n.data },
    trigger: { channelId },
  }).catch((e) => logger.warn('keepalive', 'notification', e))
}

/** Seulement app en arrière-plan : au premier plan, rien ne change. */
const background = () => useKeepAlive.getState().active && AppState.currentState !== 'active'

function context() {
  const user = useAuth.getState().user
  const quiet = queryClient.getQueryData<ServerSideSettings>(settingsKey)
  const convs = queryClient.getQueryData<ConversationSummary[]>(qk.conversations)
  const conv = (id: string) => convs?.find((c) => c.id === id)
  return {
    myId: getMyId(),
    dnd: user?.status === 'dnd',
    focus: !!user?.focus_mode,
    quiet: !!quiet?.quiet_hours_enabled && inQuietHours(quiet.quiet_hours_start, quiet.quiet_hours_end, new Date()),
    preview: useSettings.getState().pushPreview,
    isMuted: (id: string) => !!conv(id)?.is_muted,
    groupName: (id: string) => {
      const c = conv(id)
      return c?.is_group ? c.name : null
    },
  }
}

/** Notifications locales en arrière-plan, et relance du service après un appel. */
export function bindKeepAlive(): () => void {
  const onMessage = async (e: RealtimeEvent) => {
    if (!background()) return
    // Aperçu d'un MP/groupe chiffré : déchiffré ici, sur l'appareil.
    const kind = e.type === 'DM_MESSAGE' ? 'dm' : e.type === 'GROUP_DM_MESSAGE' ? 'group' : null
    const id = kind === 'dm' ? e.dm_id : e.group_id
    const ev = kind && typeof id === 'string' && e.message && typeof e.message === 'object'
      ? { ...e, message: await openRaw(kind, id, e.message as Record<string, unknown>) }
      : e
    const n = noticeFor(ev, context())
    if (n) show(n, 'messages')
  }
  const offs = ['DM_MESSAGE', 'GROUP_DM_MESSAGE', 'MENTION_CREATE'].map((t) => realtime.on(t, onMessage))

  // Appels entrants : l'écran d'appel existe déjà (Overlays) ; la notification le rend visible et
  // le toucher rouvre l'app dessus (kind « call » : aucune navigation).
  const ring = (title: string, body: string) => background() && show({ id: 'call', title, body, data: { kind: 'call' } }, 'calls')
  const unring = () => void Notifications.dismissNotificationAsync('call').catch(() => undefined)
  offs.push(
    useCall.subscribe((s, p) => {
      if (s.incoming && !p.incoming) ring(s.incoming.fromUsername, t(s.incoming.callType === 'video' ? 'store.notify.incomingVideo' : 'store.notify.incomingVoice'))
      else if (!s.incoming && p.incoming) unring()
    }),
    useGroupCall.subscribe((s, p) => {
      if (s.ring && !p.ring) ring(s.ring.fromUsername, t('store.notify.incomingGroup'))
      else if (!s.ring && p.ring) unring()
    }),
  )

  // Fin d'appel : CallForegroundService libère le verrou de veille partagé des tâches headless.
  // Relancer notre service (déjà au premier plan) redémarre sa tâche et reprend le verrou.
  const refresh = () =>
    setTimeout(() => {
      if (useKeepAlive.getState().active && !inCall()) native?.startKeepAlive()
    }, 3000)
  offs.push(
    useCall.subscribe((s, p) => s.phase === 'idle' && p.phase !== 'idle' && refresh()),
    useVoice.subscribe((s, p) => !s.channelId && !!p.channelId && refresh()),
    useGroupCall.subscribe((s, p) => !s.groupId && !!p.groupId && refresh()),
  )
  return () => offs.forEach((off) => off())
}
