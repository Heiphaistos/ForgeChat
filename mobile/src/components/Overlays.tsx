import { Ionicons } from '@expo/vector-icons'
import { router, usePathname } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Linking from 'expo-linking'
import { IS_LAN, apiOrigin } from '@/config/env'
import { updateFromRequired } from '@/features/updates/useUpdateCheck'
import { useT } from '@/i18n'
import { formatDuration } from '@/lib/format'
import { useNow } from '@/lib/useNow'
import { errorMessage, useApiHealth } from '@/lib/http'
import { useConnection } from '@/lib/realtime'
import { useOffline } from '@/lib/offline'
import { useAuth } from '@/stores/auth'
import { callRoom, useCall } from '@/stores/call'
import { useGroupCall } from '@/stores/groupCall'
import { useLock } from '@/stores/lock'
import { useVoice, voiceRoom } from '@/stores/voice'
import { colors, font, radius, spacing } from '@/theme'
import { Avatar } from './Avatar'
import { Button, Loading, type IconName } from './ui'
import { useQuery } from '@tanstack/react-query'
import { useShallow } from 'zustand/react/shallow'
import { serversApi } from '@/api/servers'
import { qk } from '@/lib/queryClient'
import { screenShareStats } from '@/services/livekit'

/** Écran de démarrage / hors-ligne au-dessus de la navigation. */
export function BootOverlay() {
  const t = useT()
  const status = useAuth((s) => s.status)
  const bootstrap = useAuth((s) => s.bootstrap)
  const logout = useAuth((s) => s.logout)
  const busy = useApiHealth((s) => s.unavailable)
  if (status !== 'booting' && status !== 'offline') return null
  return (
    <View style={[StyleSheet.absoluteFill, styles.full]}>
      {status === 'booting' ? (
        <Loading label={t('overlay.secureConnection')} />
      ) : (
        <View style={{ alignItems: 'center', gap: spacing.lg, padding: spacing.xl }}>
          <Ionicons name="cloud-offline-outline" size={56} color={colors.textMuted} />
          <Text style={styles.title}>{t(busy ? 'overlay.serverBusy' : 'overlay.unreachable')}</Text>
          <Text style={styles.sub}>{t(busy ? 'overlay.serverBusyRetry' : 'overlay.checkConnection')}</Text>
          <Button title={t('common.retry')} onPress={() => void bootstrap()} style={{ alignSelf: 'stretch' }} />
          <Button title={t('you.logout')} variant="ghost" onPress={() => void logout()} />
        </View>
      )}
    </View>
  )
}

/** Voile opaque tant que l'app est verrouillée (biométrie). */
export function LockOverlay() {
  const t = useT()
  const locked = useLock((s) => s.locked)
  const unlock = useLock((s) => s.unlock)
  const signedIn = useAuth((s) => s.status === 'signedIn')
  useEffect(() => {
    if (locked && signedIn) void unlock()
  }, [locked, signedIn, unlock])
  if (!locked || !signedIn) return null
  return (
    <View style={[StyleSheet.absoluteFill, styles.full]} accessibilityViewIsModal>
      <Ionicons name="lock-closed" size={56} color={colors.primary} />
      <Text style={[styles.title, { marginTop: spacing.lg }]}>{t('overlay.locked')}</Text>
      <Button title={t('overlay.unlock')} icon="finger-print" onPress={() => void unlock()} style={{ marginTop: spacing.xl, minWidth: 220 }} />
    </View>
  )
}

/** Bandeau de connexion temps réel perdue. */
export function ConnectionBanner() {
  const t = useT()
  const status = useConnection((s) => s.status)
  const signedIn = useAuth((s) => s.status === 'signedIn')
  const insets = useSafeAreaInsets()
  // Ne s'affiche qu'après 2,5 s de coupure (évite le clignotement lors des reconnexions rapides).
  const [delayed, setDelayed] = useState(status)
  useEffect(() => {
    const timer = setTimeout(() => setDelayed(status), status === 'reconnecting' ? 2500 : 0)
    return () => clearTimeout(timer)
  }, [status])
  const { fromCache, pending } = useOffline()
  const visible = status === 'reconnecting' && delayed === 'reconnecting'
  if (!signedIn || (!visible && !pending)) return null
  return (
    <View style={[styles.banner, { top: insets.top }]} pointerEvents="none" accessibilityLiveRegion="polite">
      <Text style={styles.bannerText}>
        {[visible && t(fromCache ? 'offline.banner' : 'overlay.reconnecting'), pending > 0 && t('offline.pending', { n: pending })]
          .filter(Boolean)
          .join(' · ')}
      </Text>
    </View>
  )
}

/**
 * Santé de l'API (lib/http) : 503 = bandeau discret « Serveur momentanément indisponible »
 * (session gardée, nouvel essai avec backoff) ; 426 = « Mets à jour ForgeChat » : vérification par
 * manifeste signé (bannière de mise à jour), repli sur la page de téléchargement du serveur.
 */
export function ApiHealthBanner() {
  const t = useT()
  const { unavailable, updateRequired } = useApiHealth()
  const signedIn = useAuth((s) => s.status === 'signedIn')
  const insets = useSafeAreaInsets()
  if (updateRequired) {
    return (
      <Pressable
        style={[styles.banner, { top: insets.top + 28 }]}
        onPress={() => void updateFromRequired(() => void Linking.openURL(`${apiOrigin()}/telecharger`).catch(() => undefined))}
        accessibilityRole="link"
      >
        <Text style={styles.bannerText}>{t('overlay.updateRequired')}</Text>
      </Pressable>
    )
  }
  if (!unavailable || !signedIn) return null
  return (
    <View style={[styles.banner, { top: insets.top + 28 }]} pointerEvents="none" accessibilityLiveRegion="polite">
      <Text style={styles.bannerText}>{t('overlay.serverBusy')}</Text>
    </View>
  )
}

/** Profil LAN : rappel permanent qu'il s'agit d'un APK de test local (jamais distribué). */
export function EnvBanner() {
  const t = useT()
  const insets = useSafeAreaInsets()
  if (!IS_LAN) return null
  return (
    <View style={[styles.envBanner, { top: insets.top + 2 }]} pointerEvents="none" accessibilityLabel={t('sw.env.label')}>
      <Text style={styles.bannerText}>{t('sw.env.badge')}</Text>
    </View>
  )
}

/** Appel entrant (plein écran). */
export function IncomingCallOverlay() {
  const t = useT()
  const incoming = useCall((s) => s.incoming)
  const accept = useCall((s) => s.accept)
  const decline = useCall((s) => s.decline)
  const locked = useLock((s) => s.locked)
  const insets = useSafeAreaInsets()
  if (!incoming) return null
  return (
    <View style={[StyleSheet.absoluteFill, styles.call, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xxl }]}>
      <View style={{ alignItems: 'center', gap: spacing.md }}>
        <Avatar uri={incoming.fromAvatar} name={incoming.fromUsername} size={96} />
        <Text style={styles.title}>{incoming.fromUsername}</Text>
        <Text style={styles.sub}>{t(incoming.callType === 'video' ? 'overlay.incomingVideo' : 'overlay.incomingVoice')}</Text>
      </View>
      <View style={styles.callButtons}>
        <Pressable style={[styles.round, { backgroundColor: colors.danger }]} onPress={decline} accessibilityRole="button" accessibilityLabel={t('overlay.decline')}>
          <Ionicons name="call" size={30} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
        </Pressable>
        <Pressable
          style={[styles.round, { backgroundColor: colors.success }]}
          onPress={async () => {
            // Si l'app est verrouillée, on exige le déverrouillage avant de décrocher.
            if (locked && !(await useLock.getState().unlock())) return
            await accept()
            router.push('/call')
          }}
          accessibilityRole="button"
          accessibilityLabel={t('overlay.accept')}
        >
          <Ionicons name={incoming.callType === 'video' ? 'videocam' : 'call'} size={30} color="#fff" />
        </Pressable>
      </View>
    </View>
  )
}

/** Appel de groupe qui démarre : rejoindre ou ignorer. */
export function GroupRingOverlay() {
  const t = useT()
  const ring = useGroupCall((s) => s.ring)
  const insets = useSafeAreaInsets()
  if (!ring) return null
  const join = async () => {
    if (useCall.getState().phase !== 'idle') {
      Alert.alert(t('voice.inCall'), t('overlay.hangUpFirst'))
      return
    }
    if (useLock.getState().locked && !(await useLock.getState().unlock())) return
    useVoice.getState().leave()
    try {
      await useGroupCall.getState().join(ring.groupId, ring.callType)
      router.push('/group-call')
    } catch (e) {
      Alert.alert(t('conv.callFailed'), errorMessage(e))
    }
  }
  return (
    <View style={[StyleSheet.absoluteFill, styles.call, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xxl }]}>
      <View style={{ alignItems: 'center', gap: spacing.md }}>
        <Ionicons name="people" size={72} color={colors.textMuted} />
        <Text style={styles.title}>{ring.fromUsername}</Text>
        <Text style={styles.sub}>{t(ring.callType === 'video' ? 'overlay.groupVideo' : 'overlay.groupVoice')}</Text>
      </View>
      <View style={styles.callButtons}>
        <Pressable style={[styles.round, { backgroundColor: colors.danger }]} onPress={useGroupCall.getState().dismissRing} accessibilityRole="button" accessibilityLabel={t('overlay.ignoreGroup')}>
          <Ionicons name="close" size={30} color="#fff" />
        </Pressable>
        <Pressable style={[styles.round, { backgroundColor: colors.success }]} onPress={() => void join()} accessibilityRole="button" accessibilityLabel={t('overlay.joinGroup')}>
          <Ionicons name={ring.callType === 'video' ? 'videocam' : 'call'} size={30} color="#fff" />
        </Pressable>
      </View>
    </View>
  )
}

/** Résolution et images/s réellement envoyées pendant le partage d'écran, relues toutes les 2 s. */
function useShareStats(active: boolean) {
  const [stats, setStats] = useState<{ width: number; height: number; fps: number } | null>(null)
  useEffect(() => {
    if (!active) return
    const read = () => void screenShareStats(callRoom() ?? voiceRoom()).then(setStats)
    read()
    const timer = setInterval(read, 2000)
    return () => clearInterval(timer)
  }, [active])
  return active ? stats : null
}

/** Partage d'écran en cours (appel ou vocal) : bandeau rouge avec Arrêter. La notification
 *  système du service mediaProjection reste aussi affichée hors de l'app. */
export function ScreenShareBanner() {
  const t = useT()
  const callSharing = useCall((s) => s.screenSharing)
  const voiceSharing = useVoice((s) => s.screenSharing)
  const insets = useSafeAreaInsets()
  const stats = useShareStats(callSharing || voiceSharing)
  if (!callSharing && !voiceSharing) return null
  const stop = () => {
    if (callSharing) useCall.getState().stopScreenShare()
    if (voiceSharing) useVoice.getState().stopScreenShare()
  }
  return (
    <View style={[styles.shareBar, { top: insets.top + 4 }]} accessibilityLiveRegion="polite">
      <Ionicons name="tv-outline" size={16} color="#fff" />
      <Text style={styles.shareText}>
        {t('overlay.sharing')}
        {stats ? ` · ${stats.width}×${stats.height} · ${t('ux.call.fps', { n: stats.fps })}` : ''}
      </Text>
      <Pressable onPress={stop} accessibilityRole="button" accessibilityLabel={t('voice.stopShare')} style={styles.shareStop} hitSlop={6}>
        <Text style={styles.shareStopText}>{t('overlay.stop')}</Text>
      </Pressable>
    </View>
  )
}

/** Barre « appel en cours » / « vocal connecté », visible partout ailleurs dans l'appli : nom du
 *  salon et du serveur (ou de la personne, du groupe), micro, haut-parleur et raccrocher. */
export function ActiveCallBar() {
  const t = useT()
  const pathname = usePathname()
  const insets = useSafeAreaInsets()
  // Seulement les champs affichés : la liste des orateurs change sans cesse pendant un appel.
  const call = useCall(useShallow((c) => ({ phase: c.phase, partnerName: c.partnerName, connectedAt: c.connectedAt, micMuted: c.micMuted, speaker: c.speaker, screenSharing: c.screenSharing, toggleMic: c.toggleMic, toggleSpeaker: c.toggleSpeaker, hangup: c.hangup })))
  const group = useGroupCall(useShallow((g) => ({ groupId: g.groupId, groupName: g.groupName, micMuted: g.micMuted, speaker: g.speaker, toggleMic: g.toggleMic, toggleSpeaker: g.toggleSpeaker, leave: g.leave })))
  const voice = useVoice(useShallow((v) => ({ serverId: v.serverId, channelId: v.channelId, channelName: v.channelName, muted: v.muted, speaker: v.speaker, screenSharing: v.screenSharing, toggleMute: v.toggleMute, toggleSpeaker: v.toggleSpeaker, leave: v.leave })))
  const servers = useQuery({ queryKey: qk.servers, queryFn: serversApi.list, enabled: !!voice.serverId })
  const now = useNow(1000, call.phase === 'connected')

  // Le bandeau de partage d'écran prend cette place ; inutile sur l'écran d'appel lui-même.
  if (call.screenSharing || voice.screenSharing || pathname === '/call' || pathname === '/group-call') return null
  let bar: { icon: IconName; label: string; open: () => void; muted: boolean; speaker: boolean; toggleMic: () => void; toggleSpeaker: () => void; hangup: () => void } | null = null
  if (call.phase !== 'idle') {
    bar = {
      icon: 'call',
      label: `${call.partnerName ?? ''} · ${call.phase === 'connected' && call.connectedAt ? formatDuration(now - call.connectedAt) : t('overlay.calling')}`,
      open: () => router.push('/call'),
      muted: call.micMuted, speaker: call.speaker, toggleMic: call.toggleMic, toggleSpeaker: call.toggleSpeaker, hangup: call.hangup,
    }
  } else if (group.groupId) {
    bar = {
      icon: 'people',
      label: group.groupName ? t('overlay.groupCallNamed', { name: group.groupName }) : t('overlay.groupCall'),
      open: () => router.push('/group-call'),
      muted: group.micMuted, speaker: group.speaker, toggleMic: group.toggleMic, toggleSpeaker: group.toggleSpeaker, hangup: group.leave,
    }
  } else if (voice.channelName && voice.serverId && voice.channelId && !pathname.startsWith('/voice/')) {
    const { serverId, channelId, channelName } = voice
    const server = servers.data?.find((x) => x.id === serverId)?.name
    bar = {
      icon: 'volume-high',
      label: server ? `${channelName} · ${server}` : t('overlay.voice', { name: channelName }),
      open: () => router.push({ pathname: '/voice/[serverId]/[channelId]', params: { serverId, channelId, name: channelName } }),
      muted: voice.muted, speaker: voice.speaker, toggleMic: voice.toggleMute, toggleSpeaker: voice.toggleSpeaker, hangup: voice.leave,
    }
  }
  if (!bar) return null
  const button = (icon: IconName, label: string, onPress: () => void, bg = 'rgba(0,0,0,0.25)') => (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} style={[styles.barButton, { backgroundColor: bg }]}>
      <Ionicons name={icon} size={16} color="#fff" />
    </Pressable>
  )
  return (
    <View style={[styles.activeBar, { top: insets.top }]} accessibilityLiveRegion="polite">
      <Pressable onPress={bar.open} accessibilityRole="button" style={styles.barLabel} hitSlop={4}>
        <Ionicons name={bar.icon} size={14} color="#fff" />
        <Text style={styles.activeText} numberOfLines={1}>{bar.label}</Text>
      </Pressable>
      {button(bar.muted ? 'mic-off' : 'mic', t(bar.muted ? 'ux.call.unmute' : 'ux.call.mute'), bar.toggleMic)}
      {button(bar.speaker ? 'volume-high' : 'ear-outline', t(bar.speaker ? 'ux.call.earpiece' : 'ux.call.speaker'), bar.toggleSpeaker)}
      {button('call', t('ux.call.hangup'), bar.hangup, colors.danger)}
    </View>
  )
}

const styles = StyleSheet.create({
  full: { backgroundColor: colors.bgDeep, alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  title: { color: colors.text, fontSize: font.xl, fontWeight: '800', textAlign: 'center' },
  sub: { color: colors.textMuted, fontSize: font.md, textAlign: 'center' },
  banner: { position: 'absolute', alignSelf: 'center', backgroundColor: colors.warning, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 4, zIndex: 50 },
  bannerText: { color: '#000', fontWeight: '700', fontSize: font.xs },
  shareBar: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.danger, borderRadius: radius.full, paddingLeft: spacing.md, paddingRight: 4, paddingVertical: 4, zIndex: 96 },
  shareText: { color: '#fff', fontWeight: '700', fontSize: font.sm },
  shareStop: { backgroundColor: '#fff', borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 6 },
  shareStopText: { color: colors.danger, fontWeight: '800', fontSize: font.sm },
  envBanner: { position: 'absolute', right: spacing.sm, backgroundColor: colors.warning, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2, opacity: 0.85, zIndex: 95 },
  call: { backgroundColor: colors.bgDeep, justifyContent: 'space-between', alignItems: 'center', zIndex: 90 },
  callButtons: { flexDirection: 'row', gap: 80 },
  round: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  activeBar: {
    position: 'absolute',
    alignSelf: 'center',
    maxWidth: '94%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.success,
    borderRadius: radius.full,
    paddingLeft: spacing.md,
    paddingRight: 4,
    paddingVertical: 3,
    zIndex: 40,
  },
  barLabel: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  barButton: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  activeText: { flexShrink: 1, color: '#fff', fontWeight: '700', fontSize: font.xs },
})
