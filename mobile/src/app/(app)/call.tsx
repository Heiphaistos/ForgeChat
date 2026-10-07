import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Avatar } from '@/components/Avatar'
import { CallButton, useAudioRoute } from '@/components/call/CallControls'
import { CallVideoView } from '@/components/call/CallVideoView'
import { PipView } from '@/components/call/PipView'
import { QualityIcon, type CallTile } from '@/components/call/VideoTile'
import { canShareInCall, isScreenShareCancel } from '@/features/calls/screenShareLogic'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { confirmScreenShare, screenShareSupported } from '@/services/screenCapture'
import { defaultRatio, useCallPip } from '@/services/callWindow'
import { formatDuration } from '@/lib/format'
import { useNow } from '@/lib/useNow'
import { useAuth } from '@/stores/auth'
import { useCall } from '@/stores/call'
import { callColors, colors, font, spacing } from '@/theme'
import { E2ECallBadge } from '@/e2e/E2ECallBadge'
import { promptSupport } from '@/features/chat/SupportCard'

/**
 * Appel privé. En vidéo, la vidéo du correspondant occupe tout l'écran (zoom, remplir / ajuster),
 * ma caméra en vignette déplaçable (un appui échange les deux), commandes masquées après quelques
 * secondes, bouton plein écran immersif (rotation suivie) et image dans l'image en quittant l'app.
 */
export default function CallScreen() {
  const t = useT()
  const s = useCall()
  const me = useAuth((st) => st.user)
  const insets = useSafeAreaInsets()
  const now = useNow(1000, s.phase === 'connected')
  const [immersive, setImmersive] = useState(false)
  const [swapped, setSwapped] = useState(false)
  const route = useAudioRoute(s.speaker, s.toggleSpeaker, (on) => useCall.setState({ speaker: on }))

  const toggleShare = async () => {
    if (s.screenSharing) {
      s.stopScreenShare()
      return
    }
    if (!(await confirmScreenShare())) return
    try {
      await s.shareScreen()
    } catch (e) {
      // Refus dans le dialogue système : pas d'alerte (choix volontaire).
      if (!isScreenShareCancel(e)) Alert.alert(t('voice.shareFailed'), errorMessage(e))
    }
  }

  // Fin d'appel : fermer l'écran.
  useEffect(() => {
    if (s.phase === 'idle' && !s.incoming) {
      const timer = setTimeout(() => (router.canGoBack() ? router.back() : router.replace('/')), s.endReason ? 1200 : 0)
      return () => clearTimeout(timer)
    }
  }, [s.phase, s.incoming, s.endReason])

  const partnerName = s.partnerName ?? s.endedWith?.name ?? '?'
  const partnerSpeaking = !!s.partnerId && s.speaking.includes(s.partnerId)
  const remote: CallTile | null = s.remoteVideo
    ? {
        key: 'remote',
        userId: s.partnerId ?? 'remote',
        self: false,
        screen: s.remoteScreen,
        hasVideo: true,
        name: s.remoteScreen ? t('voice.screenOf', { name: partnerName }) : partnerName,
        avatar: s.partnerAvatar,
        stream: s.remoteVideo,
        muted: s.partnerMuted,
        speaking: partnerSpeaking,
        quality: s.partnerQuality,
      }
    : null
  // Pendant un partage d'écran, la caméra n'est plus envoyée : pas d'aperçu trompeur (géré par le store).
  const localVideo = s.callType === 'video' ? s.localVideo : null
  const local: CallTile | null = localVideo
    ? {
        key: 'local',
        userId: me?.id ?? 'me',
        self: true,
        screen: false,
        hasVideo: true,
        name: me?.username ?? t('call.you'),
        avatar: me?.avatar ?? null,
        stream: localVideo,
        mirror: s.facing === 'user',
        muted: s.micMuted,
        speaking: !!me && s.speaking.includes(me.id),
      }
    : null
  const main = (swapped && local) || remote || local
  const vignette = main === remote ? local : remote
  const inPip = useCallPip(main ? defaultRatio(main.screen) : null)
  if (inPip) return <PipView tile={main} />

  const label =
    s.phase === 'calling'
      ? t('call.calling')
      : s.phase === 'connecting'
        ? t('voice.connecting')
        : s.phase === 'connected' && s.connectedAt
          ? formatDuration(now - s.connectedAt)
          : (s.endReason ?? '')

  const controls = (
    <>
      <CallButton icon={s.micMuted ? 'mic-off' : 'mic'} label={t(s.micMuted ? 'voice.unmuteMic' : 'voice.muteMic')} onPress={s.toggleMic} active={s.micMuted} />
      {s.callType === 'video' ? (
        <>
          <CallButton icon={s.camOff ? 'videocam-off' : 'videocam'} label={t('call.camera')} onPress={s.toggleCam} active={s.camOff} />
          <CallButton icon="camera-reverse" label={t('voice.switchCamera')} onPress={s.switchCamera} />
          {screenShareSupported && canShareInCall(s.phase, s.callType) ? (
            <CallButton
              icon="tv-outline"
              label={t(s.screenSharing ? 'voice.stopShare' : 'voice.share')}
              onPress={() => void toggleShare()}
              active={s.screenSharing}
            />
          ) : null}
        </>
      ) : null}
      <CallButton icon={route.icon} label={route.label} onPress={route.open} active={route.onSpeaker} />
      {s.dmId ? <CallButton icon="help-buoy-outline" label={t('rs.button')} onPress={() => promptSupport(s.dmId!)} /> : null}
      <CallButton icon="call" label={t('call.hangUp')} onPress={s.hangup} danger />
    </>
  )

  const info = (
    <>
      <View style={styles.nameRow}>
        {s.partnerMuted ? <Ionicons name="mic-off" size={16} color={colors.danger} accessibilityLabel={t('call.micOff')} /> : null}
        <QualityIcon quality={s.partnerQuality} size={16} />
        <Text style={styles.name} numberOfLines={1}>
          {partnerName}
        </Text>
      </View>
      <Text style={styles.status}>{label}</Text>
      <E2ECallBadge encrypted={s.e2ee} outdatedNames={s.e2eeOutdated.length ? [s.partnerName ?? '…'] : []} />
      {s.warning && s.phase !== 'idle' ? <Text style={styles.warning}>{s.warning}</Text> : null}
    </>
  )

  if (main) {
    return (
      <View style={styles.container}>
        <CallVideoView
          sources={[main]}
          current={main.key}
          onCurrent={() => undefined}
          vignette={vignette}
          onVignettePress={() => setSwapped((v) => !v)}
          immersive={immersive}
          onImmersive={setImmersive}
          // Sous le bandeau « Partage d'écran en cours » quand il est affiché.
          header={<View style={[styles.videoInfo, s.screenSharing && { marginTop: 40 }]}>{info}</View>}
          controls={controls}
        />
        {route.sheet}
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.center}>
        <View style={[styles.avatarRing, partnerSpeaking && { borderColor: colors.success }]}>
          <Avatar uri={s.partnerAvatar ?? s.endedWith?.avatar ?? null} name={partnerName} size={120} />
        </View>
      </View>
      {/* Sous le bandeau « Partage d'écran en cours » quand il est affiché. */}
      <View style={[styles.top, { paddingTop: insets.top + spacing.lg + (s.screenSharing ? 48 : 0) }]} pointerEvents="none">
        {info}
      </View>
      <View style={[styles.controls, { paddingBottom: insets.bottom + spacing.xl }]}>{controls}</View>
      {route.sheet}
    </View>
  )
}

// Écran d'appel toujours sombre (comme Discord) : texte et boutons blancs lisibles quel que soit le thème.
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: callColors.bg },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  avatarRing: { borderRadius: 999, borderWidth: 4, borderColor: 'transparent', padding: 4 },
  top: { alignItems: 'center', gap: 4 },
  videoInfo: { alignItems: 'flex-start', gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' },
  name: { color: '#fff', fontSize: font.xxl, fontWeight: '800', textShadowColor: '#000', textShadowRadius: 6, flexShrink: 1 },
  status: { color: '#dbdee1', fontSize: font.md, textShadowColor: '#000', textShadowRadius: 6 },
  warning: { color: colors.warning, fontSize: font.sm, textAlign: 'center', paddingHorizontal: spacing.lg, textShadowColor: '#000', textShadowRadius: 6 },
  // Jusqu'à 6 boutons (appel vidéo) : passage à la ligne sur les écrans étroits.
  controls: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm },
})
