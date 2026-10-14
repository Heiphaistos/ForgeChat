import { Ionicons } from '@expo/vector-icons'
import { Stack, router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CallButton, useAudioRoute } from '@/components/call/CallControls'
import { CallVideoView } from '@/components/call/CallVideoView'
import { PipView } from '@/components/call/PipView'
import { VideoStage } from '@/components/call/VideoStage'
import type { CallTile } from '@/components/call/VideoTile'
import { Sheet, type SheetAction } from '@/components/Sheet'
import { openUserMenu } from '@/features/userMenu/UserMenuHost'
import { usePeerVolumes } from '@/stores/peerVolumes'
import { Button, ErrorState, PasswordField, type IconName } from '@/components/ui'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { isScreenShareCancel } from '@/features/calls/screenShareLogic'
import { mainVideoTile } from '@/features/calls/videoLayout'
import { useServerPerms } from '@/features/servers/menus'
import { PERM } from '@/features/servers/perms'
import { SoundboardSheet } from '@/features/voice/SoundboardSheet'
import { StagePanel } from '@/features/voice/StagePanel'
import { WatchPanel } from '@/features/voice/WatchPanel'
import { defaultRatio, useCallPip } from '@/services/callWindow'
import { confirmScreenShare, screenShareSupported } from '@/services/screenCapture'
import { useAuth } from '@/stores/auth'
import { useCall } from '@/stores/call'
import { useGroupCall } from '@/stores/groupCall'
import { useVoice } from '@/stores/voice'
import { useWatch } from '@/stores/watch'
import { useT, type Key } from '@/i18n'
import { colors, font, radius, spacing } from '@/theme'
import { E2ECallBadge } from '@/e2e/E2ECallBadge'
import { VoiceLotBanners } from '@/features/voice/VoiceLotBanners'
import { openVoiceStatus } from '@/features/voice/voiceStatus'

const REACTIONS = ['👍', '😂', '🎉', '❤️', '😮', '👏']
const QUALITY_LABEL: Record<string, Key> = { poor: 'voice.weak', lost: 'voice.lost' }

export default function VoiceScreen() {
  const t = useT()
  const { valid, ids, text } = useRouteParams(['serverId', 'channelId'] as const, ['name', 'locked', 'stage'])
  const v = useVoice()
  const me = useAuth((s) => s.user)
  const insets = useSafeAreaInsets()
  const [password, setPassword] = useState('')
  // Vidéo ouverte en plein écran et tuile épinglée en grand (clés de tuile).
  const [open, setOpen] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const volumes = usePeerVolumes((s) => s.volumes)
  const [more, setMore] = useState(false)
  const [sounds, setSounds] = useState(false)
  const [watching, setWatching] = useState(false)
  const perms = useServerPerms(ids.serverId ?? '', valid)
  const watch = useWatch((s) => s.watch)
  const route = useAudioRoute(v.speaker, v.toggleSpeaker, (on) => useVoice.setState({ speaker: on }))

  const myId = me?.id ?? 'me'
  const tiles: CallTile[] = [
    {
      key: 'me',
      userId: myId,
      self: true,
      screen: false,
      hasVideo: !!v.localVideo,
      name: me?.username ?? t('voice.me'),
      avatar: me?.avatar ?? null,
      stream: v.localVideo,
      mirror: v.facing === 'user',
      muted: v.muted,
      speaking: v.speaking.includes(myId),
      quality: v.quality,
      badges: <TileBadges handRaised={v.handRaised} reaction={v.reactions[myId]} />,
    },
  ]
  for (const p of v.peers) {
    const camera = p.video && p.stream?.getVideoTracks().length ? p.stream : null
    tiles.push({
      key: p.userId,
      userId: p.userId,
      self: false,
      screen: false,
      hasVideo: !!camera,
      name: p.username,
      avatar: p.avatar,
      stream: camera,
      muted: p.muted,
      speaking: v.speaking.includes(p.userId),
      quality: v.qualities[p.userId] ?? null,
      badges: <TileBadges handRaised={p.handRaised} recording={p.recording} reaction={v.reactions[p.userId]} volume={volumes[p.userId]} />,
    })
    if (p.screenStream?.getVideoTracks().length) {
      tiles.push({
        key: `${p.userId}:screen`,
        userId: p.userId,
        self: false,
        screen: true,
        hasVideo: true,
        name: t('voice.screenOf', { name: p.username }),
        avatar: p.avatar,
        stream: p.screenStream,
        quality: v.qualities[p.userId] ?? null,
        badges: p.recording ? <TileBadges recording /> : undefined,
      })
    }
  }
  const videos = tiles.filter((x) => x.hasVideo)
  const fullscreen = open && videos.some((x) => x.key === open) ? open : null
  const big = tiles.find((x) => x.key === (fullscreen ?? pinned))
  const pipTile = (fullscreen ? big : null) ?? mainVideoTile(tiles, pinned, v.speaking)
  const inPip = useCallPip(!v.stage && pipTile ? defaultRatio(pipTile.screen) : null)
  // Caméra regardée en grand : reçue en haute qualité (les tuiles restent en qualité moyenne).
  const focusCamera = v.focusCamera
  const focusedCamera = big && !big.self && !big.screen ? big.userId : null
  useEffect(() => focusCamera(focusedCamera), [focusCamera, focusedCamera])

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

  const status =
    v.mediaStatus === 'reconnecting'
      ? t('voice.reconnecting')
      : v.joining || v.mediaStatus === 'connecting'
        ? t('voice.connecting')
        : v.quality
          ? QUALITY_LABEL[v.quality] && t(QUALITY_LABEL[v.quality]!)
          : undefined

  const moreActions: SheetAction[] = [
    { label: t(v.handRaised ? 'voice.lowerHand' : 'voice.raiseHand'), icon: 'hand-left-outline', onPress: v.toggleHand },
    ...(v.video ? [{ label: t('voice.switchCamera'), icon: 'camera-reverse' as IconName, onPress: v.switchCamera }] : []),
    ...(screenShareSupported && !v.listenOnly
      ? [{ label: t(v.screenSharing ? 'voice.stopShare' : 'voice.share'), icon: 'tv-outline' as IconName, onPress: () => void toggleShare() }]
      : []),
    // Statut du salon (ligne sous le salon dans la liste) : salon où je suis connecté.
    ...(v.channelId && v.serverId ? [{ label: t('df.voice.set'), icon: 'chatbubble-ellipses-outline' as IconName, onPress: openVoiceStatus.bind(null, v.serverId, v.channelId) }] : []),
  ]

  const leave = () => {
    v.leave()
    router.back()
  }
  const header = <Stack.Screen options={{ title: `${isStage ? '📻' : '🔊'} ${name}`, headerShown: !(here && (inPip || fullscreen)) }} />
  if (here && inPip) {
    return (
      <>
        {header}
        <PipView tile={pipTile} />
      </>
    )
  }
  if (here && fullscreen) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {header}
        <CallVideoView
          sources={videos}
          current={fullscreen}
          onCurrent={setOpen}
          vignette={tiles[0]}
          onVignettePress={() => setOpen('me')}
          immersive
          onClose={() => setOpen(null)}
          controls={
            <>
              <CallButton
                icon={v.muted ? 'mic-off' : 'mic'}
                label={t(v.muted ? 'voice.unmuteMic' : 'voice.muteMic')}
                onPress={v.toggleMute}
                active={v.muted}
                dim={v.speakLocked || v.listenOnly}
              />
              <CallButton icon={v.deafened ? 'volume-mute' : 'headset'} label={t('voice.deafen')} onPress={v.toggleDeafen} active={v.deafened} />
              {!v.listenOnly ? (
                <CallButton icon={v.video ? 'videocam' : 'videocam-off'} label={t(v.video ? 'voice.cameraOff' : 'voice.cameraOn')} onPress={() => void v.toggleCamera()} />
              ) : null}
              {v.video ? <CallButton icon="camera-reverse" label={t('voice.switchCamera')} onPress={v.switchCamera} /> : null}
              <CallButton icon={route.icon} label={route.label} onPress={route.open} active={route.onSpeaker} />
              <CallButton icon="call" label={t('voice.leave')} onPress={leave} danger />
            </>
          }
        />
        {route.sheet}
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgDeep }}>
      {header}
      {route.sheet}
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
          <E2ECallBadge encrypted={v.e2ee} outdatedNames={v.e2eeOutdated.map((id) => v.peers.find((p) => p.userId === id)?.username ?? '…')} />
          <VoiceLotBanners canAdmit={perms.has(PERM.MOVE_MEMBERS)} />
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
              <VideoStage
                tiles={tiles}
                pinned={pinned}
                onPin={setPinned}
                onOpen={setOpen}
                onLongPress={(tile) => {
                  const peer = tile.self || tile.screen ? undefined : v.peers.find((p) => p.userId === tile.userId)
                  // Menu de la personne (volume, support à distance via son MP, profil…).
                  if (peer) openUserMenu({ userId: peer.userId, name: peer.username, avatar: peer.avatar, serverId: ids.serverId, volume: true })
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
            <Control icon={route.icon} label={route.label} onPress={route.open} />
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
              onPress={leave}
            />
          </View>
        </>
      )}
    </View>
  )
}

/** Indicateurs d'une tuile du salon : main levée, enregistrement, volume réglé, réaction. */
function TileBadges({ handRaised, recording, volume, reaction }: { handRaised?: boolean; recording?: boolean; volume?: number; reaction?: string }) {
  const t = useT()
  const louder = volume !== undefined && volume !== 1
  return (
    <>
      {reaction ? <Text style={styles.reaction}>{reaction}</Text> : null}
      {handRaised || recording || louder ? (
        <View style={styles.badges} pointerEvents="none">
          {handRaised ? <Text accessibilityLabel={t('voice.handRaised')}>✋</Text> : null}
          {recording ? <Ionicons name="radio-button-on" size={14} color={colors.danger} accessibilityLabel={t('voice.recording')} /> : null}
          {louder ? <Ionicons name={volume === 0 ? 'volume-mute' : 'volume-high'} size={14} color={colors.warning} /> : null}
        </View>
      ) : null}
    </>
  )
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
  reaction: { position: 'absolute', top: 44, right: 8, fontSize: 28 },
  badges: { position: 'absolute', top: 8, right: 8, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  reactions: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.bgAlt },
  controls: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.md, paddingTop: spacing.sm, paddingHorizontal: spacing.sm, backgroundColor: colors.bgAlt },
  dot: { position: 'absolute', top: 4, right: 4, width: 12, height: 12, borderRadius: 6, backgroundColor: colors.success, borderWidth: 2, borderColor: colors.bgAlt },
  ctrl: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.bgHover, alignItems: 'center', justifyContent: 'center' },
})
