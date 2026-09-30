import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { friendsApi } from '@/api/friends'
import { usersApi } from '@/api/users'
import { Avatar } from '@/components/Avatar'
import { Button, ErrorState, Loading, Section } from '@/components/ui'
import { MessageText } from '@/components/MessageText'
import { openDmWith } from '@/features/friends/openDm'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk, queryClient } from '@/lib/queryClient'
import { useAuth } from '@/stores/auth'
import { colors, font, spacing } from '@/theme'

export default function UserScreen() {
  const { valid, ids } = useRouteParams(['userId'] as const)
  const me = useAuth((s) => s.user)
  const q = useQuery({ queryKey: qk.user(ids.userId ?? ''), queryFn: () => usersApi.get(ids.userId), enabled: valid })
  if (!valid) return <ErrorState message="Profil invalide." />
  if (q.isLoading) return <Loading />
  if (q.error || !q.data) return <ErrorState message={errorMessage(q.error, 'Profil introuvable')} onRetry={() => void q.refetch()} />
  const u = q.data
  const isMe = u.id === me?.id

  const run = (fn: () => Promise<unknown>, ok: string) =>
    fn()
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: qk.friendsAll })
        Alert.alert(ok)
      })
      .catch((e) => Alert.alert('Action impossible', errorMessage(e)))

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl }}>
      <View style={styles.header}>
        <Avatar uri={u.avatar} name={u.username} size={96} userId={u.id} status={u.status} showStatus />
        <Text style={styles.name}>{u.username}</Text>
        <Text style={styles.tag}>
          {u.username}#{u.discriminator}
          {u.pronouns ? ` · ${u.pronouns}` : ''}
        </Text>
        {u.custom_status ? <Text style={styles.status}>{u.custom_status}</Text> : null}
      </View>

      {u.bio ? (
        <Section title="À propos">
          <View style={{ padding: spacing.lg }}>
            <MessageText content={u.bio} />
          </View>
        </Section>
      ) : null}

      {!isMe ? (
        <View style={{ gap: spacing.md }}>
          <Button title="Envoyer un message" icon="chatbubble" onPress={() => void openDmWith(u.id, u.username)} />
          <Button
            title="Ajouter en ami"
            icon="person-add"
            variant="secondary"
            onPress={() => run(() => friendsApi.addByName(`${u.username}#${u.discriminator}`), 'Demande d’ami envoyée')}
          />
          <Button
            title="Bloquer"
            icon="ban"
            variant="ghost"
            onPress={() =>
              Alert.alert('Bloquer cet utilisateur ?', `${u.username} ne pourra plus t'écrire ni t'appeler.`, [
                { text: 'Annuler', style: 'cancel' },
                { text: 'Bloquer', style: 'destructive', onPress: () => run(() => friendsApi.block(u.id), 'Utilisateur bloqué') },
              ])
            }
          />
        </View>
      ) : (
        <Button title="Modifier mon profil" onPress={() => router.push('/settings/profile')} />
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: 4, marginBottom: spacing.xl },
  name: { color: colors.text, fontSize: font.xxl, fontWeight: '800', marginTop: spacing.md },
  tag: { color: colors.textMuted },
  status: { color: colors.textSecondary, marginTop: spacing.sm },
})
