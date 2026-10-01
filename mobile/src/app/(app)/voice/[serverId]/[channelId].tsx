import { Ionicons } from '@expo/vector-icons'
import { Stack, router } from 'expo-router'
import { useState } from 'react'
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { RTCView } from 'react-native-webrtc'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Avatar } from '@/components/Avatar'
import { StreamViewer, type ViewerSource } from '@/components/StreamViewer'
import { Button, EmptyState, ErrorState, PasswordField } from '@/components/ui'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { isScreenShareCancel } from '@/features/calls/screenShareLogic'
import { confirmScreenShare, screenShareSupported } from '@/services/screenCapture'
import { useAuth } from '@/stores/auth'
import { useCall } from '@/stores/call'
import { useVoice, type VoicePeer } from '@/stores/voice'
import { colors, font, radius, spacing } from '@/theme'

export default function VoiceScreen() {
  const { valid, ids, text } = useRouteParams(['serverId', 'channelId'] as const, ['name', 'locked'])
  const v = useVoice()
  const me = useAuth((s) => s.user)
  const insets = useSafeAreaInsets()
  const [password, setPassword] = useState('')
  // Visionneuse plein écran : pair affiché et source choisie (caméra ou écran).
  const [viewing, setViewing] = useState<{ userId: string; key: string } | null>(null)
  if (!valid) return <ErrorState message="Lien de salon vocal invalide." />

  const name = text.name ?? 'Salon vocal'
  const here = v.channelId === ids.channelId || (v.joined && v.serverId === ids.serverId && v.channelName === name)
  const needsPassword = text.locked === '1'

  const join = async () => {
    if (useCall.getState().phase !== 'idle') {
      Alert.alert('Appel en cours', 'Raccroche avant de rejoindre un salon vocal.')
      return
    }
    try {
      await v.join(ids.serverId, ids.channelId, name, needsPassword ? password : undefined)
    } catch (e) {
      Alert.alert('Impossible de rejoindre', errorMessage(e))
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
      if (!isScreenShareCancel(e)) Alert.alert('Partage impossible', errorMessage(e))
    }
  }

  const viewedPeer = viewing ? v.peers.find((p) => p.userId === viewing.userId) : undefined
  const viewerSources: ViewerSource[] = viewedPeer ? peerSources(viewedPeer) : []

  type Tile = { key: string; peer: Pick<VoicePeer, 'userId' | 'username' | 'avatar' | 'muted'>; stream: VoicePeer['stream']; screen: boolean }
  const meTile: Tile = { key: 'me', peer: { userId: me?.id ?? 'me', username: me?.username ?? 'Moi', avatar: me?.avatar ?? null, muted: v.muted }, stream: null, screen: false }
  const tiles: Tile[] = [meTile]
  for (const p of v.peers) {
    tiles.push({ key: p.userId, peer: p, stream: p.video && p.stream?.getVideoTracks().length ? p.stream : null, screen: false })
    if (p.screenStream?.getVideoTracks().length) tiles.push({ key: `${p.userId}:screen`, peer: p, stream: p.screenStream, screen: true })
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgDeep }}>
      <Stack.Screen options={{ title: `🔊 ${name}` }} />
      <StreamViewer sources={viewerSources} initialKey={viewing && viewerSources.length ? viewing.key : null} onClose={() => setViewing(null)} />
      {!here ? (
        <View style={styles.join}>
          <Ionicons name="volume-high" size={56} color={colors.textMuted} />
          <Text style={styles.title}>{name}</Text>
          {v.error ? <Text style={{ color: colors.danger }}>{v.error}</Text> : null}
          {needsPassword ? (
            <View style={styles.pw}>
              <PasswordField placeholder="Mot de passe du salon" value={password} onChangeText={setPassword} />
            </View>
          ) : null}
          <Button title="Rejoindre le vocal" icon="mic" onPress={join} loading={v.joining} style={{ alignSelf: 'stretch' }} />
        </View>
      ) : (
        <>
          <FlatList
            data={tiles}
            keyExtractor={(t) => t.key}
            numColumns={2}
            contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
            columnWrapperStyle={{ gap: spacing.md }}
            ListEmptyComponent={<EmptyState icon="mic-outline" title="Connexion…" />}
            renderItem={({ item }) => {
              const label = item.screen ? `Écran de ${item.peer.username}` : item.peer.username
              const open = item.stream ? () => setViewing({ userId: item.peer.userId, key: item.screen ? 'screen' : 'camera' }) : undefined
              return (
                <Pressable
                  style={styles.tile}
                  onPress={open}
                  disabled={!open}
                  accessibilityRole={open ? 'button' : undefined}
                  accessibilityLabel={open ? `${label}, afficher en plein écran` : label}
                >
                  {item.stream ? (
                    <RTCView streamURL={item.stream.toURL()} style={StyleSheet.absoluteFill} objectFit={item.screen ? 'contain' : 'cover'} />
                  ) : (
                    <Avatar uri={item.peer.avatar} name={item.peer.username} size={64} />
                  )}
                  <View style={styles.tileLabel}>
                    {item.screen ? <Ionicons name="tv-outline" size={12} color="#fff" /> : null}
                    {!item.screen && item.peer.muted ? <Ionicons name="mic-off" size={12} color={colors.danger} /> : null}
                    <Text style={styles.tileName} numberOfLines={1}>
                      {label}
                    </Text>
                  </View>
                </Pressable>
              )
            }}
          />
          <View style={[styles.controls, { paddingBottom: insets.bottom + spacing.md }]}>
            <Control icon={v.muted ? 'mic-off' : 'mic'} label={v.muted ? 'Réactiver le micro' : 'Couper le micro'} onPress={v.toggleMute} active={v.muted} />
            <Control icon={v.deafened ? 'volume-mute' : 'headset'} label="Sourdine" onPress={v.toggleDeafen} active={v.deafened} />
            <Control icon={v.speaker ? 'volume-high' : 'ear-outline'} label="Haut-parleur" onPress={v.toggleSpeaker} />
            {screenShareSupported ? (
              <Control
                icon="tv-outline"
                label={v.screenSharing ? 'Arrêter le partage d’écran' : 'Partager l’écran'}
                onPress={() => void toggleShare()}
                active={v.screenSharing}
              />
            ) : null}
            <Control
              icon="call"
              label="Quitter le vocal"
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
  if (p.video && p.stream?.getVideoTracks().length) out.push({ key: 'camera', label: `Caméra de ${p.username}`, stream: p.stream })
  if (p.screenStream?.getVideoTracks().length) out.push({ key: 'screen', label: `Écran de ${p.username}`, stream: p.screenStream })
  return out
}

function Control({ icon, label, onPress, active, danger }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; active?: boolean; danger?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.ctrl, active && { backgroundColor: colors.text }, danger && { backgroundColor: colors.danger }]}
    >
      <Ionicons name={icon} size={24} color={active ? colors.bgDeep : '#fff'} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  join: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg },
  title: { color: colors.text, fontSize: font.xl, fontWeight: '800' },
  pw: { alignSelf: 'stretch' },
  tile: { flex: 1, aspectRatio: 1, backgroundColor: colors.bgAlt, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  tileLabel: { position: 'absolute', left: 8, bottom: 8, right: 8, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  tileName: { color: '#fff', fontSize: font.xs, fontWeight: '700', flexShrink: 1 },
  controls: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg, paddingTop: spacing.md, backgroundColor: colors.bgAlt },
  ctrl: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.bgHover, alignItems: 'center', justifyContent: 'center' },
})
