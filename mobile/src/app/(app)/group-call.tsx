import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useEffect } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { RTCView } from '@livekit/react-native-webrtc'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { dmsApi } from '@/api/dms'
import { Avatar } from '@/components/Avatar'
import type { IconName } from '@/components/ui'
import { useT } from '@/i18n'
import { qk } from '@/lib/queryClient'
import { useAuth } from '@/stores/auth'
import { useGroupCall } from '@/stores/groupCall'
import { colors, font, radius, spacing } from '@/theme'

/** Appel de groupe en cours : une tuile par participant (caméra ou avatar), contrôles en bas. */
export default function GroupCallScreen() {
  const t = useT()
  const s = useGroupCall()
  const me = useAuth((st) => st.user)
  const insets = useSafeAreaInsets()
  const group = useQuery({ queryKey: qk.group(s.groupId ?? ''), queryFn: () => dmsApi.group(s.groupId ?? ''), enabled: !!s.groupId })

  // Appel terminé (raccroché, erreur) : fermer l'écran, le motif reste lisible un instant.
  useEffect(() => {
    if (s.groupId) return
    const t = setTimeout(() => (router.canGoBack() ? router.back() : router.replace('/')), s.error ? 1500 : 0)
    return () => clearTimeout(t)
  }, [s.groupId, s.error])

  const members = new Map((group.data?.members ?? []).map((m) => [m.id, m]))
  const others = (s.groupId ? (s.active[s.groupId] ?? []) : []).filter((id) => id !== me?.id)
  for (const id of Object.keys(s.remotes)) if (!others.includes(id)) others.push(id)
  const tiles = [{ id: me?.id ?? 'me', self: true }, ...others.map((id) => ({ id, self: false }))]

  const status = s.status === 'connecting'
      ? t('voice.connecting')
      : s.status === 'reconnecting'
        ? t('call.reconnecting')
        : (s.error ?? t(tiles.length > 1 ? 'call.participantsMany' : 'call.participants', { n: tiles.length }))

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
      <Text style={styles.title} numberOfLines={1}>
        {s.groupName ?? group.data?.name ?? t('call.group')}
      </Text>
      <Text style={styles.status}>{status}</Text>
      <FlatList
        data={tiles}
        keyExtractor={(t) => t.id}
        numColumns={2}
        contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
        columnWrapperStyle={{ gap: spacing.md }}
        renderItem={({ item }) => {
          const stream = item.self ? s.localVideo : s.remotes[item.id]
          const m = item.self ? me : members.get(item.id)
          const name = item.self ? t('call.you') : (m?.username ?? '…')
          const speaking = s.speaking.includes(item.id)
          return (
            <View style={[styles.tile, speaking && { borderColor: colors.success }]} accessibilityLabel={`${name}${speaking ? ', parle' : ''}`}>
              {stream ? (
                <RTCView streamURL={stream.toURL()} style={StyleSheet.absoluteFill} objectFit="cover" mirror={item.self} />
              ) : (
                <Avatar uri={m?.avatar ?? null} name={name} size={64} />
              )}
              <View style={styles.label}>
                {item.self && s.micMuted ? <Ionicons name="mic-off" size={12} color={colors.danger} /> : null}
                <Text style={styles.labelText} numberOfLines={1}>
                  {name}
                </Text>
              </View>
            </View>
          )
        }}
      />
      <View style={[styles.controls, { paddingBottom: insets.bottom + spacing.xl }]}>
        <Btn icon={s.micMuted ? 'mic-off' : 'mic'} label={t(s.micMuted ? 'voice.unmuteMic' : 'voice.muteMic')} onPress={s.toggleMic} active={s.micMuted} />
        <Btn icon={s.camOff ? 'videocam-off' : 'videocam'} label={t(s.camOff ? 'voice.cameraOn' : 'voice.cameraOff')} onPress={() => void s.toggleCam()} active={!s.camOff} />
        {!s.camOff ? <Btn icon="camera-reverse" label={t('voice.switchCamera')} onPress={s.switchCamera} /> : null}
        <Btn icon={s.speaker ? 'volume-high' : 'volume-low'} label={t('voice.speaker')} onPress={s.toggleSpeaker} active={s.speaker} />
        <Btn icon="call" label={t('call.leave')} onPress={s.leave} danger />
      </View>
    </View>
  )
}

function Btn({ icon, label, onPress, active, danger }: { icon: IconName; label: string; onPress: () => void; active?: boolean; danger?: boolean }) {
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

// Écran d'appel toujours sombre (comme Discord) : boutons blancs lisibles quel que soit le thème.
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111214' },
  title: { color: '#f2f3f5', fontSize: font.xl, fontWeight: '800', textAlign: 'center', paddingHorizontal: spacing.lg },
  status: { color: '#949ba4', fontSize: font.sm, textAlign: 'center', marginTop: 4 },
  tile: { flex: 1, aspectRatio: 1, backgroundColor: '#2b2d31', borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  label: { position: 'absolute', left: 8, bottom: 8, right: 8, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  labelText: { color: '#fff', fontSize: font.xs, fontWeight: '700', flexShrink: 1 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.md, paddingTop: spacing.md, paddingHorizontal: spacing.sm },
  btn: { width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
})
