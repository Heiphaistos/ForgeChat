import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { RTCView } from '@livekit/react-native-webrtc'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Avatar } from '@/components/Avatar'
import { StreamViewer } from '@/components/StreamViewer'
import { canShareInCall, isScreenShareCancel } from '@/features/calls/screenShareLogic'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { confirmScreenShare, screenShareSupported } from '@/services/screenCapture'
import { formatDuration } from '@/lib/format'
import { useNow } from '@/lib/useNow'
import { useCall } from '@/stores/call'
import { colors, font, spacing } from '@/theme'
import type { IconName } from '@/components/ui'

function CallButton({ icon, label, onPress, active, danger }: { icon: IconName; label: string; onPress: () => void; active?: boolean; danger?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}
      style={[styles.btn, active && { backgroundColor: colors.text }, danger && { backgroundColor: colors.danger }]}
    >
      <Ionicons name={icon} size={26} color={active ? colors.bgDeep : '#fff'} />
    </Pressable>
  )
}

export default function CallScreen() {
  const t = useT()
  const s = useCall()
  const insets = useSafeAreaInsets()
  const now = useNow(1000, s.phase === 'connected')
  const [viewer, setViewer] = useState(false)

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

  const remoteVideo = s.remoteVideo
  // Pendant un partage d'écran, la caméra n'est plus envoyée : pas d'aperçu trompeur (géré par le store).
  const localVideo = s.callType === 'video' ? s.localVideo : null
  const label =
    s.phase === 'calling'
      ? t('call.calling')
      : s.phase === 'connecting'
        ? t('voice.connecting')
        : s.phase === 'connected' && s.connectedAt
          ? formatDuration(now - s.connectedAt)
          : (s.endReason ?? '')

  return (
    <View style={styles.container}>
      {remoteVideo ? (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => setViewer(true)}
          accessibilityRole="button"
          accessibilityLabel={t('call.fullscreen')}
        >
          <RTCView streamURL={remoteVideo.toURL()} style={StyleSheet.absoluteFill} objectFit="cover" zOrder={0} />
        </Pressable>
      ) : (
        <View style={styles.center}>
          <Avatar uri={s.partnerAvatar ?? s.endedWith?.avatar ?? null} name={s.partnerName ?? s.endedWith?.name ?? '?'} size={120} />
        </View>
      )}

      <StreamViewer
        sources={remoteVideo ? [{ key: 'remote', label: s.partnerName ?? t('call.video'), stream: remoteVideo }] : []}
        initialKey={viewer && remoteVideo ? 'remote' : null}
        onClose={() => setViewer(false)}
      />

      {/* Sous le bandeau « Partage d'écran en cours » quand il est affiché. */}
      <View style={[styles.top, { paddingTop: insets.top + spacing.lg + (s.screenSharing ? 48 : 0) }]} pointerEvents="none">
        <Text style={styles.name}>{s.partnerName ?? s.endedWith?.name}</Text>
        <Text style={styles.status}>{label}</Text>
        {s.warning && s.phase !== 'idle' ? <Text style={styles.warning}>{s.warning}</Text> : null}
      </View>

      {localVideo ? (
        <View style={[styles.pip, { top: insets.top + 90 }]}>
          <RTCView streamURL={localVideo.toURL()} style={{ flex: 1 }} objectFit="cover" mirror={s.facing === 'user'} zOrder={1} />
        </View>
      ) : null}

      <View style={[styles.controls, { paddingBottom: insets.bottom + spacing.xl }]}>
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
        <CallButton icon={s.speaker ? 'volume-high' : 'volume-low'} label={t('voice.speaker')} onPress={s.toggleSpeaker} active={s.speaker} />
        <CallButton icon="call" label={t('call.hangUp')} onPress={s.hangup} danger />
      </View>
    </View>
  )
}

// Écran d'appel toujours sombre (comme Discord) : texte et boutons blancs lisibles quel que soit le thème.
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111214' },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  top: { alignItems: 'center', gap: 4 },
  name: { color: '#fff', fontSize: font.xxl, fontWeight: '800', textShadowColor: '#000', textShadowRadius: 6 },
  status: { color: '#dbdee1', fontSize: font.md, textShadowColor: '#000', textShadowRadius: 6 },
  warning: { color: colors.warning, fontSize: font.sm, textAlign: 'center', paddingHorizontal: spacing.lg, textShadowColor: '#000', textShadowRadius: 6 },
  pip: { position: 'absolute', right: spacing.lg, width: 110, height: 160, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' },
  // Jusqu'à 6 boutons (appel vidéo) : passage à la ligne sur les écrans étroits.
  controls: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm },
  btn: { width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
})
