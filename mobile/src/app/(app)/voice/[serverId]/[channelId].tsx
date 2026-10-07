import { Ionicons } from '@expo/vector-icons'
import { Stack, router } from 'expo-router'
import { useState } from 'react'
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { RTCView } from '@livekit/react-native-webrtc'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Avatar } from '@/components/Avatar'
import { Sheet, type SheetAction } from '@/components/Sheet'
import { StreamViewer, type ViewerSource } from '@/components/StreamViewer'
import { Button, ErrorState, PasswordField, type IconName } from '@/components/ui'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { isScreenShareCancel } from '@/features/calls/screenShareLogic'
import { useServerPerms } from '@/features/servers/menus'
import { PERM } from '@/features/servers/perms'
import { SoundboardSheet } from '@/features/voice/SoundboardSheet'
import { StagePanel } from '@/features/voice/StagePanel'
import { WatchPanel } from '@/features/voice/WatchPanel'
import { confirmScreenShare, screenShareSupported } from '@/services/screenCapture'
import { useAuth } from '@/stores/auth'
import { useCall } from '@/stores/call'
import { useGroupCall } from '@/stores/groupCall'
import { useVoice, type VoicePeer } from '@/stores/voice'
import { useWatch } from '@/stores/watch'
import { t as tr, useT, type Key } from '@/i18n'
import { colors, font, radius, spacing } from '@/theme'

const REACTIONS = ['👍', '😂', '🎉', '❤️', '😮', '👏']
const VOLUMES: { label: Key; value: number }[] = [
  { label: 'voice.mute', value: 0 },
  { label: 'voice.vol50', value: 0.5 },
  { label: 'voice.vol100', value: 1 },
  { label: 'voice.vol200', value: 2 },
]
const QUALITY_LABEL: Record<string, Key> = { poor: 'voice.weak', lost: 'voice.lost' }

export default function VoiceScreen() {
  const t = useT()
  const { valid, ids, text } = useRouteParams(['serverId', 'channelId'] as const, ['name', 'locked', 'stage'])
  const v = useVoice()
  const me = useAuth((s) => s.user)
  const insets = useSafeAreaInsets()
  const [password, setPassword] = useState('')
  // Visionneuse plein écran : pair affiché et source choisie (caméra ou écran).
  const [viewing, setViewing] = useState<{ userId: string; key: string } | null>(null)
  const [volumeOf, setVolumeOf] = useState<VoicePeer | null>(null)
  const [more, setMore] = useState(false)
  const [sounds, setSounds] = useState(false)
  const [watching, setWatching] = useState(false)
  const perms = useServerPerms(ids.serverId ?? '', valid)
  const watch = useWatch((s) => s.watch)
  if (!valid) return <ErrorState message={t('voice.invalid')} />

  // Salon auto-création : channelId devient le salon temporaire, entryChannelId reste celui choisi.
  const here = !!v.channelId && (v.channelId === ids.channelId || v.entryChannelId === ids.channelId)
  const name = (here ? v.channelName : null) ?? text.name ?? t('voice.fallback')
  const needsPassword = text.locked === '1'
  // Barre « en vocal » (Overlays) : pas de paramètre `stage`, l'état du store fait foi.
  const isStage = here ? !!v.stage : text.stage === '1'

  const join = async (listenOnly: boolean) => {
    if (useCall.getState().phase !== 'idle') {
      Alert.alert(t('voice.inCall'), t('voice.hangUpFirst'))
      return
    }
    if (useGroupCall.getState().groupId) {
      Alert.alert(t('voice.groupCall'), t('voice.leaveGroupCallFirst'))
      return
    }
    try {
      const pw = needsPassword ? password : undefined
      await (isStage ? v.joinStage(ids.serverId, ids.channelId, name, pw) : v.join(ids.serverId, ids.channelId, name, pw, listenOnly))
    } catch (e) {
      Alert.alert(t('voice.joinFailed'), errorMessage(e))
    }
  }

  const toggleShare = async () => {
    if (v.screenSharing) {
      v.stopScreenShare()
      return
    }
    if (!(await confirmScreenShare())) return
    try {
      await v.shareScreen()
    } catch (e) {
      // Refus dans le dialogue système : pas d'alerte (choix volontaire).
      if (!isScreenShareCancel(e)) Alert.alert(t('voice.shareFailed'), errorMessage(e))
    }
  }

  const viewedPeer = viewing ? v.peers.find((p) => p.userId === viewing.userId) : undefined
  const viewerSources: ViewerSource[] = viewedPeer ? peerSources(viewedPeer) : []

  type Tile = {
    key: string
    peer: Pick<VoicePeer, 'userId' | 'username' | 'avatar' | 'muted' | 'handRaised' | 'recording'>
    stream: VoicePeer['stream']
    screen: boolean
    self: boolean
  }
  const myId = me?.id ?? 'me'
  const tiles: Tile[] = [
    {
      key: 'me',
      peer: { userId: myId, username: me?.username ?? t('voice.me'), avatar: me?.avatar ?? null, muted: v.muted, handRaised: v.handRaised, recording: false },
      stream: v.localVideo,
      screen: false,
      self: true,
    },
  ]
  for (const p of v.peers) {
    tiles.push({ key: p.userId, peer: p, stream: p.video && p.stream?.getVideoTracks().length ? p.stream : null, screen: false, self: false })
    if (p.screenStream?.getVideoTracks().length) tiles.push({ key: `${p.userId}:screen`, peer: p, stream: p.screenStream, screen: true, self: false })
  }

  const status =
    v.mediaStatus === 'reconnecting'
      ? t('voice.reconnecting')
      : v.joining || v.mediaStatus === 'connecting'
        ? t('voice.connecting')
        : v.quality
          ? QUALITY_LABEL[v.quality] && t(QUALITY_LABEL[v.quality]!)
          : undefined

  const volumeActions: SheetAction[] = volumeOf
    ? VOLUMES.map((o) => ({
        label: t(o.label),
        icon: o.value === 0 ? 'volume-mute' : 'volume-high',
        selected: (v.volumes[volumeOf.userId] ?? 1) === o.value,
        onPress: () => v.setPeerVolume(volumeOf.userId, o.value),
      }))
    : []
  const moreActions: SheetAction[] = [
    { label: t(v.handRaised ? 'voice.lowerHand' : 'voice.raiseHand'), icon: 'hand-left-outline', onPress: v.toggleHand },
    ...(v.video ? [{ label: t('voice.switchCamera'), icon: 'camera-reverse' as IconName, onPress: v.switchCamera }] : []),
    ...(screenShareSupported && !v.listenOnly
      ? [{ label: t(v.screenSharing ? 'voice.stopShare' : 'voice.share'), icon: 'tv-outline' as IconName, onPress: () => void toggleShare() }]
      : []),
  ]

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgDeep }}>
      <Stack.Screen options={{ title: `${isStage ? '📻' : '🔊'} ${name}` }} />
      <StreamViewer sources={viewerSources} initialKey={viewing && viewerSources.length ? viewing.key : null} onClose={() => setViewing(null)} />
      <Sheet visible={!!volumeOf} onClose={() => setVolumeOf(null)} title={volumeOf ? t('voice.volumeOf', { name: volumeOf.username }) : undefined} actions={volumeActions} />
      <Sheet visible={more} onClose={() => setMore(false)} actions={moreActions} />
      {here ? <SoundboardSheet serverId={ids.serverId} canManage={perms.has(PERM.MANAGE_SERVER)} visible={sounds} onClose={() => setSounds(false)} /> : null}
      {!here ? (
        <View style={styles.join}>
          <Ionicons name={isStage ? 'radio-outline' : 'volume-high'} size={56} color={colors.textMuted} />
          <Text style={styles.title}>{name}</Text>
          {v.error ? <Text style={{ color: colors.danger, textAlign: 'center' }}>{v.error}</Text> : null}
          {needsPassword ? (
            <View style={styles.pw}>
              <PasswordField placeholder={t('voice.password')} value={password} onChangeText={setPassword} />
            </View>
          ) : null}
          {isStage ? (
            <Button title={t('voice.joinStage')} icon="headset" onPress={() => void join(true)} loading={v.joining} style={{ alignSelf: 'stretch' }} />
          ) : (
            <>
              <Button title={t('voice.join')} icon="mic" onPress={() => void join(false)} loading={v.joining} style={{ alignSelf: 'stretch' }} />
              <Button title={t('voice.listenOnly')} icon="headset" variant="ghost" onPress={() => void join(true)} disabled={v.joining} />
            </>
          )}
        </View>
      ) : (
        <>
          {v.error ? <Banner text={v.error} tone="danger" onPress={v.dismiss} /> : v.notice ? <Banner text={v.notice} tone="info" onPress={v.dismiss} /> : null}
          {status ? <Banner text={status} tone="warning" /> : null}
          {watching && !v.stage && v.channelId ? (
            <WatchPanel channelId={v.channelId} onClose={() => setWatching(false)} />
          ) : watch && !v.stage ? (
            // « Regarder ensemble » en cours, lecteur masqué : un appui le rouvre.
            <Pressable
              style={[styles.banner, { backgroundColor: colors.primary }]}
              onPress={() => setWatching(true)}
              accessibilityRole="button"
              accessibilityHint={t('voice.watchHint')}
            >
              <Ionicons name="logo-youtube" size={16} color="#fff" />
              <Text style={[styles.bannerText, { color: '#fff' }]} numberOfLines={2}>
                {watch.by === myId ? t('voice.youWatch') : t('voice.watches', { name: v.peers.find((p) => p.userId === watch.by)?.username ?? t('voice.theChannel') })} : youtu.be/
                {watch.videoId}
                {watch.playing ? '' : t('voice.paused')} — {t('voice.watch')}
              </Text>
            </Pressable>
          ) : null}
          {v.stage ? (
            <View style={{ flex: 1 }}>
              <StagePanel
                me={{ userId: myId, username: me?.username ?? t('voice.me'), avatar: me?.avatar ?? null }}
                isModerator={perms.has(PERM.MANAGE_CHANNELS)}
              />
            </View>
          ) : (
            <>
              <FlatList
                data={tiles}
                keyExtractor={(t) => t.key}
                numColumns={2}
                contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
                columnWrapperStyle={{ gap: spacing.md }}
                renderItem={({ item }) => {
                  const label = item.screen ? t('voice.screenOf', { name: item.peer.username }) : item.peer.username
                  const open = item.stream && !item.self ? () => setViewing({ userId: item.peer.userId, key: item.screen ? 'screen' : 'camera' }) : undefined
                  const speaking = !item.screen && v.speaking.includes(item.peer.userId)
                  const reaction = item.screen ? undefined : v.reactions[item.peer.userId]
                  const peer = item.self || item.screen ? undefined : v.peers.find((p) => p.userId === item.peer.userId)
                  const volume = v.volumes[item.peer.userId]
                  return (
                    <Pressable
                      style={[styles.tile, speaking && styles.speaking]}
                      onPress={open}
                      onLongPress={peer ? () => setVolumeOf(peer) : undefined}
                      accessibilityRole="button"
                      accessibilityLabel={`${label}${speaking ? t('voice.speaking') : ''}${item.peer.handRaised ? t('voice.handRaised') : ''}`}
                      accessibilityHint={peer ? t('voice.volumeHint') : undefined}
                    >
                      {item.stream ? (
                        <RTCView
                          streamURL={item.stream.toURL()}
                          style={StyleSheet.absoluteFill}
                          objectFit={item.screen ? 'contain' : 'cover'}
                          mirror={item.self && v.facing === 'user'}
                        />
                      ) : (
                        <Avatar uri={item.peer.avatar} name={item.peer.username} size={64} />
                      )}
                      {reaction ? <Text style={styles.reaction}>{reaction}</Text> : null}
                      <View style={styles.tileLabel}>
                        {item.screen ? <Ionicons name="tv-outline" size={12} color="#fff" /> : null}
                        {!item.screen && item.peer.muted ? <Ionicons name="mic-off" size={12} color={colors.danger} /> : null}
                        {!item.screen && item.peer.handRaised ? <Text style={styles.tileName}>✋</Text> : null}
                        {item.peer.recording ? <Ionicons name="radio-button-on" size={12} color={colors.danger} accessibilityLabel={t('voice.recording')} /> : null}
                        {volume !== undefined && volume !== 1 ? <Ionicons name={volume === 0 ? 'volume-mute' : 'volume-high'} size={12} color={colors.warning} /> : null}
                        <Text style={styles.tileName} numberOfLines={1}>
                          {item.self ? t('voice.you', { name: label }) : label}
                        </Text>
                      </View>
                    </Pressable>
                  )
                }}
              />
              <View style={styles.reactions}>
                {REACTIONS.map((emoji) => (
                  <Pressable key={emoji} onPress={() => v.react(emoji)} accessibilityRole="button" accessibilityLabel={t('voice.react', { emoji })} hitSlop={4}>
                    <Text style={{ fontSize: 22 }}>{emoji}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
          <View style={[styles.controls, { paddingBottom: insets.bottom + spacing.md }]}>
            <Control
              icon={v.muted ? 'mic-off' : 'mic'}
              label={t(v.muted ? 'voice.unmuteMic' : 'voice.muteMic')}
              onPress={v.toggleMute}
              active={v.muted}
              dim={v.speakLocked || v.listenOnly}
            />
            <Control icon={v.deafened ? 'volume-mute' : 'headset'} label={t('voice.deafen')} onPress={v.toggleDeafen} active={v.deafened} />
            {!v.listenOnly && !v.stage ? (
              <Control icon={v.video ? 'videocam' : 'videocam-off'} label={t(v.video ? 'voice.cameraOff' : 'voice.cameraOn')} onPress={() => void v.toggleCamera()} active={v.video} />
            ) : null}
            <Control icon={v.speaker ? 'volume-high' : 'ear-outline'} label={t('voice.speaker')} onPress={v.toggleSpeaker} />
            {v.stage ? null : <Control icon="musical-notes" label={t('voice.soundboard')} onPress={() => setSounds(true)} />}
            {v.stage ? null : (
              <Control icon="logo-youtube" label={t('voice.watchTogether')} onPress={() => setWatching((w) => !w)} active={watching} dot={!!watch} />
            )}
            {v.stage ? null : (
              <Control icon="ellipsis-horizontal" label={t('voice.more')} onPress={() => setMore(true)} active={v.handRaised || v.screenSharing} />
            )}
            <Control
              icon="call"
              label={t('voice.leave')}
              danger
              onPress={() => {
                v.leave()
                router.back()
              }}
            />
          </View>
        </>
      )}
    </View>
  )
}

/** Sources plein écran d'un pair : caméra et/ou écran partagé. */
function peerSources(p: VoicePeer): ViewerSource[] {
  const out: ViewerSource[] = []
  if (p.video && p.stream?.getVideoTracks().length) out.push({ key: 'camera', label: tr('voice.cameraOf', { name: p.username }), stream: p.stream })
  if (p.screenStream?.getVideoTracks().length) out.push({ key: 'screen', label: tr('voice.screenOf', { name: p.username }), stream: p.screenStream })
  return out
}

function Banner({ text, tone, onPress }: { text: string; tone: 'danger' | 'info' | 'warning'; onPress?: () => void }) {
  const bg = tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning : colors.primary
  const fg = tone === 'warning' ? '#000' : '#fff'
  const t = useT()
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[styles.banner, { backgroundColor: bg }]}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLiveRegion="polite"
      accessibilityHint={onPress ? t('voice.dismiss') : undefined}
    >
      <Text style={[styles.bannerText, { color: fg }]}>{text}</Text>
      {onPress ? <Ionicons name="close" size={16} color={fg} /> : null}
    </Pressable>
  )
}

function Control({ icon, label, onPress, active, danger, dim, dot }: { icon: IconName; label: string; onPress: () => void; active?: boolean; danger?: boolean; dim?: boolean; dot?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}
      style={[styles.ctrl, active && { backgroundColor: colors.text }, danger && { backgroundColor: colors.danger }, dim && { opacity: 0.5 }]}
    >
      <Ionicons name={icon} size={24} color={active ? colors.bgDeep : '#fff'} />
      {/* Point vert : une vidéo tourne dans le salon. */}
      {dot ? <View style={styles.dot} /> : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  join: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg },
  title: { color: colors.text, fontSize: font.xl, fontWeight: '800' },
  pw: { alignSelf: 'stretch' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  bannerText: { flex: 1, fontSize: font.sm, fontWeight: '600' },
  tile: {
    flex: 1,
    aspectRatio: 1,
    backgroundColor: colors.bgAlt,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  speaking: { borderColor: colors.success },
  reaction: { position: 'absolute', top: 6, right: 8, fontSize: 28 },
  tileLabel: { position: 'absolute', left: 8, bottom: 8, right: 8, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  tileName: { color: '#fff', fontSize: font.xs, fontWeight: '700', flexShrink: 1 },
  reactions: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.bgAlt },
  controls: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.md, paddingTop: spacing.sm, paddingHorizontal: spacing.sm, backgroundColor: colors.bgAlt },
  dot: { position: 'absolute', top: 4, right: 4, width: 12, height: 12, borderRadius: 6, backgroundColor: colors.success, borderWidth: 2, borderColor: colors.bgAlt },
  ctrl: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.bgHover, alignItems: 'center', justifyContent: 'center' },
})
