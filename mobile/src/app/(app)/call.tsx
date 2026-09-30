import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useEffect } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { RTCView } from 'react-native-webrtc'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Avatar } from '@/components/Avatar'
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
  const s = useCall()
  const insets = useSafeAreaInsets()
  const now = useNow(1000, s.phase === 'connected')

  // Fin d'appel : fermer l'écran.
  useEffect(() => {
    if (s.phase === 'idle' && !s.incoming) {
      const t = setTimeout(() => (router.canGoBack() ? router.back() : router.replace('/')), s.endReason ? 1200 : 0)
      return () => clearTimeout(t)
    }
  }, [s.phase, s.incoming, s.endReason])

  const remoteVideo = s.remoteStream?.getVideoTracks().length ? s.remoteStream : null
  const localVideo = s.callType === 'video' && !s.camOff && s.localStream?.getVideoTracks().length ? s.localStream : null
  const label =
    s.phase === 'calling'
      ? 'Appel en cours…'
      : s.phase === 'connecting'
        ? 'Connexion…'
        : s.phase === 'connected' && s.connectedAt
          ? formatDuration(now - s.connectedAt)
          : (s.endReason ?? '')

  return (
    <View style={styles.container}>
      {remoteVideo ? (
        <RTCView streamURL={remoteVideo.toURL()} style={StyleSheet.absoluteFill} objectFit="cover" zOrder={0} />
      ) : (
        <View style={styles.center}>
          <Avatar uri={s.partnerAvatar ?? s.endedWith?.avatar ?? null} name={s.partnerName ?? s.endedWith?.name ?? '?'} size={120} />
        </View>
      )}

      <View style={[styles.top, { paddingTop: insets.top + spacing.lg }]}>
        <Text style={styles.name}>{s.partnerName ?? s.endedWith?.name}</Text>
        <Text style={styles.status}>{label}</Text>
      </View>

      {localVideo ? (
        <View style={[styles.pip, { top: insets.top + 90 }]}>
          <RTCView streamURL={localVideo.toURL()} style={{ flex: 1 }} objectFit="cover" mirror zOrder={1} />
        </View>
      ) : null}

      <View style={[styles.controls, { paddingBottom: insets.bottom + spacing.xl }]}>
        <CallButton icon={s.micMuted ? 'mic-off' : 'mic'} label={s.micMuted ? 'Réactiver le micro' : 'Couper le micro'} onPress={s.toggleMic} active={s.micMuted} />
        {s.callType === 'video' ? (
          <>
            <CallButton icon={s.camOff ? 'videocam-off' : 'videocam'} label="Caméra" onPress={s.toggleCam} active={s.camOff} />
            <CallButton icon="camera-reverse" label="Changer de caméra" onPress={s.switchCamera} />
          </>
        ) : null}
        <CallButton icon={s.speaker ? 'volume-high' : 'volume-low'} label="Haut-parleur" onPress={s.toggleSpeaker} active={s.speaker} />
        <CallButton icon="call" label="Raccrocher" onPress={s.hangup} danger />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgDeep },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  top: { alignItems: 'center', gap: 4 },
  name: { color: '#fff', fontSize: font.xxl, fontWeight: '800', textShadowColor: '#000', textShadowRadius: 6 },
  status: { color: colors.textSecondary, fontSize: font.md, textShadowColor: '#000', textShadowRadius: 6 },
  pip: { position: 'absolute', right: spacing.lg, width: 110, height: 160, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' },
  controls: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: spacing.lg },
  btn: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
})
