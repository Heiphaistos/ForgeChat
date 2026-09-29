import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { serversApi } from '@/api/servers'
import { Avatar } from '@/components/Avatar'
import { Badge } from '@/components/ui'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { useAuth } from '@/stores/auth'
import { useUi } from '@/stores/ui'
import { directUnread, serverUnread, useUnread } from '@/stores/unread'
import { useVoice } from '@/stores/voice'
import type { Server } from '@/types/models'
import { colors, spacing } from '@/theme'

async function leaveServer(server: Server) {
  try {
    if (useVoice.getState().serverId === server.id) useVoice.getState().leave()
    await serversApi.leave(server.id)
    if (useUi.getState().selectedServerId === server.id) useUi.getState().selectServer(null)
    const { counts, serverOf, clear } = useUnread.getState()
    Object.keys(counts).forEach((id) => serverOf[id] === server.id && clear(id))
    await queryClient.invalidateQueries({ queryKey: qk.servers })
  } catch (e) {
    Alert.alert('Impossible de quitter', errorMessage(e))
  }
}

/**
 * Appui long sur un serveur. Côté serveur : inviter exige MANAGE_SERVER et le propriétaire
 * ne peut pas quitter. On propose donc « Inviter » au propriétaire et « Quitter » aux membres.
 */
function openServerActions(server: Server) {
  const isOwner = useAuth.getState().user?.id === server.owner_id
  const invite = { text: 'Inviter', onPress: () => router.push(`/server/${server.id}/invite`) }
  const cancel = { text: 'Annuler', style: 'cancel' as const }
  if (isOwner) {
    Alert.alert(server.name, undefined, [
      invite,
      { text: 'Créer un salon', onPress: () => router.push(`/server/${server.id}/channel-create`) },
      cancel,
    ], { cancelable: true })
    return
  }
  Alert.alert(server.name, undefined, [
    {
      text: 'Quitter',
      style: 'destructive',
      onPress: () =>
        Alert.alert(
          `Quitter ${server.name} ?`,
          'Tu ne pourras revenir qu’avec une nouvelle invitation.',
          [cancel, { text: 'Quitter', style: 'destructive', onPress: () => void leaveServer(server) }],
          { cancelable: true },
        ),
    },
    cancel,
  ], { cancelable: true })
}

/**
 * Colonne d'icônes de l'accueil. `selected === null` : « Messages privés ».
 * `onRetry` : affiché à la place des serveurs si leur chargement a échoué.
 */
export function ServerRail({
  servers,
  selected,
  onSelect,
  onRetry,
}: {
  servers: Server[]
  selected: string | null
  onSelect: (id: string | null) => void
  onRetry?: () => void
}) {
  const counts = useUnread((s) => s.counts)
  const serverOf = useUnread((s) => s.serverOf)
  const dmActive = selected === null
  const dmUnread = directUnread(counts, serverOf)
  return (
    <View style={styles.rail}>
      <ScrollView contentContainerStyle={{ alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md }} showsVerticalScrollIndicator={false}>
        <Pressable
          onPress={() => onSelect(null)}
          accessibilityRole="button"
          accessibilityLabel={`Messages privés${dmUnread ? `, ${dmUnread} non lus` : ''}`}
          accessibilityState={{ selected: dmActive }}
          style={styles.item}
        >
          <View style={[styles.pill, { height: dmActive ? 36 : dmUnread ? 8 : 0 }]} />
          <View style={[styles.home, dmActive && styles.homeActive]}>
            <Ionicons name="chatbubbles" size={24} color={dmActive ? '#fff' : colors.textMuted} />
          </View>
          {dmUnread ? (
            <View style={styles.badge}>
              <Badge count={dmUnread} />
            </View>
          ) : null}
        </Pressable>
        <View style={styles.separator} />
        {onRetry ? (
          <Pressable style={styles.add} onPress={onRetry} accessibilityRole="button" accessibilityLabel="Réessayer de charger les serveurs">
            <Ionicons name="refresh" size={22} color={colors.danger} />
          </Pressable>
        ) : null}
        {servers.map((s) => {
          const active = s.id === selected
          const unread = serverUnread(counts, serverOf, s.id)
          return (
            <Pressable
              key={s.id}
              onPress={() => onSelect(s.id)}
              onLongPress={() => openServerActions(s)}
              accessibilityRole="button"
              accessibilityLabel={`Serveur ${s.name}${unread ? `, ${unread} non lus` : ''}`}
              accessibilityHint="Appui long pour inviter ou quitter"
              accessibilityState={{ selected: active }}
              accessibilityActions={[{ name: 'longpress', label: 'Options du serveur' }]}
              onAccessibilityAction={(e) => e.nativeEvent.actionName === 'longpress' && openServerActions(s)}
              style={styles.item}
            >
              <View style={[styles.pill, { height: active ? 36 : unread ? 8 : 0 }]} />
              <Avatar uri={s.icon} name={s.name} size={48} rounded={!active} />
              {unread ? (
                <View style={styles.badge}>
                  <Badge count={unread} />
                </View>
              ) : null}
            </Pressable>
          )
        })}
        {servers.length ? <View style={styles.separator} /> : null}
        <Pressable style={styles.add} onPress={() => router.push('/server/create')} accessibilityRole="button" accessibilityLabel="Créer un serveur">
          <Ionicons name="add" size={26} color={colors.success} />
        </Pressable>
        <Pressable style={styles.add} onPress={() => router.push('/server/join')} accessibilityRole="button" accessibilityLabel="Rejoindre un serveur">
          <Ionicons name="enter-outline" size={22} color={colors.success} />
        </Pressable>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  rail: { width: 72, backgroundColor: colors.bgDeep },
  item: { width: 72, alignItems: 'center', justifyContent: 'center' },
  pill: { position: 'absolute', left: 0, width: 4, borderTopRightRadius: 4, borderBottomRightRadius: 4, backgroundColor: colors.text },
  badge: { position: 'absolute', right: 8, bottom: -2 },
  separator: { width: 32, height: 2, borderRadius: 1, backgroundColor: colors.bgHover },
  home: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.bgAlt, alignItems: 'center', justifyContent: 'center' },
  homeActive: { borderRadius: 16, backgroundColor: colors.primary },
  add: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.bgAlt, alignItems: 'center', justifyContent: 'center' },
})
