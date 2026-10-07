import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { dmsApi } from '@/api/dms'
import { CallButton, useAudioRoute } from '@/components/call/CallControls'
import { CallVideoView } from '@/components/call/CallVideoView'
import { PipView } from '@/components/call/PipView'
import { VideoStage } from '@/components/call/VideoStage'
import type { CallTile } from '@/components/call/VideoTile'
import { mainVideoTile } from '@/features/calls/videoLayout'
import { useT } from '@/i18n'
import { qk } from '@/lib/queryClient'
import { defaultRatio, useCallPip } from '@/services/callWindow'
import { useAuth } from '@/stores/auth'
import { useGroupCall } from '@/stores/groupCall'
import { callColors, font, spacing } from '@/theme'
import { E2ECallBadge } from '@/e2e/E2ECallBadge'

/**
 * Appel de groupe en cours : grille qui remplit l'écran (ou focus sur la personne épinglée),
 * toucher une vidéo l'ouvre en plein écran, image dans l'image en quittant l'app.
 */
export default function GroupCallScreen() {
  const t = useT()
  const s = useGroupCall()
  const me = useAuth((st) => st.user)
  const insets = useSafeAreaInsets()
  const group = useQuery({ queryKey: qk.group(s.groupId ?? ''), queryFn: () => dmsApi.group(s.groupId ?? ''), enabled: !!s.groupId })
  const [pinned, setPinned] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const route = useAudioRoute(s.speaker, s.toggleSpeaker, (on) => useGroupCall.setState({ speaker: on }))

  // Appel terminé (raccroché, erreur) : fermer l'écran, le motif reste lisible un instant.
  useEffect(() => {
    if (s.groupId) return
    const t = setTimeout(() => (router.canGoBack() ? router.back() : router.replace('/')), s.error ? 1500 : 0)
    return () => clearTimeout(t)
  }, [s.groupId, s.error])

  const members = new Map((group.data?.members ?? []).map((m) => [m.id, m]))
  const others = (s.groupId ? (s.active[s.groupId] ?? []) : []).filter((id) => id !== me?.id)
  for (const id of Object.keys(s.remotes)) if (!others.includes(id)) others.push(id)
  const myId = me?.id ?? 'me'
  const tiles: CallTile[] = [
    {
      key: myId,
      userId: myId,
      self: true,
      screen: false,
      hasVideo: !!s.localVideo,
      name: me?.username ?? t('call.you'),
      avatar: me?.avatar ?? null,
      stream: s.localVideo,
      mirror: true,
      muted: s.micMuted,
      speaking: s.speaking.includes(myId),
    },
    ...others.map((id) => ({
      key: id,
      userId: id,
      self: false,
      screen: false,
      hasVideo: !!s.remotes[id],
      name: members.get(id)?.username ?? '…',
      avatar: members.get(id)?.avatar ?? null,
      stream: s.remotes[id] ?? null,
      muted: !!s.mutedPeers[id],
      speaking: s.speaking.includes(id),
      quality: s.qualities[id] ?? null,
    })),
  ]
  const videos = tiles.filter((x) => x.hasVideo)
  const fullscreen = open && videos.some((x) => x.key === open) ? open : null
  const pipTile = (fullscreen ? videos.find((x) => x.key === fullscreen) : null) ?? mainVideoTile(tiles, pinned, s.speaking)
  const inPip = useCallPip(pipTile ? defaultRatio(pipTile.screen) : null)
  if (inPip) return <PipView tile={pipTile} />

  const status =
    s.status === 'connecting'
      ? t('voice.connecting')
      : s.status === 'reconnecting'
        ? t('call.reconnecting')
        : (s.error ?? t(tiles.length > 1 ? 'call.participantsMany' : 'call.participants', { n: tiles.length }))

  const controls = (
    <>
      <CallButton icon={s.micMuted ? 'mic-off' : 'mic'} label={t(s.micMuted ? 'voice.unmuteMic' : 'voice.muteMic')} onPress={s.toggleMic} active={s.micMuted} />
      <CallButton icon={s.camOff ? 'videocam-off' : 'videocam'} label={t(s.camOff ? 'voice.cameraOn' : 'voice.cameraOff')} onPress={() => void s.toggleCam()} active={!s.camOff} />
      {!s.camOff ? <CallButton icon="camera-reverse" label={t('voice.switchCamera')} onPress={s.switchCamera} /> : null}
      <CallButton icon={route.icon} label={route.label} onPress={route.open} active={route.onSpeaker} />
      <CallButton icon="call" label={t('call.leave')} onPress={s.leave} danger />
    </>
  )

  if (fullscreen) {
    return (
      <View style={styles.container}>
        <CallVideoView
          sources={videos}
          current={fullscreen}
          onCurrent={setOpen}
          vignette={tiles[0]}
          onVignettePress={() => setOpen(myId)}
          immersive
          onClose={() => setOpen(null)}
          controls={controls}
        />
        {route.sheet}
      </View>
    )
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
      <Text style={styles.title} numberOfLines={1}>
        {s.groupName ?? group.data?.name ?? t('call.group')}
      </Text>
      <Text style={styles.status}>{status}</Text>
      <E2ECallBadge encrypted={s.e2ee} outdatedNames={s.e2eeOutdated.map((id) => members.get(id)?.username ?? '…')} />
      <VideoStage tiles={tiles} pinned={pinned} onPin={setPinned} onOpen={setOpen} />
      <View style={[styles.controls, { paddingBottom: insets.bottom + spacing.xl }]}>{controls}</View>
      {route.sheet}
    </View>
  )
}

// Écran d'appel toujours sombre (comme Discord) : boutons blancs lisibles quel que soit le thème.
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: callColors.bg },
  title: { color: '#f2f3f5', fontSize: font.xl, fontWeight: '800', textAlign: 'center', paddingHorizontal: spacing.lg },
  status: { color: '#949ba4', fontSize: font.sm, textAlign: 'center', marginTop: 4 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.md, paddingTop: spacing.md, paddingHorizontal: spacing.sm },
})
