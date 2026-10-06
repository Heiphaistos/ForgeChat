import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { friendsApi } from '@/api/friends'
import { usersApi } from '@/api/users'
import { Avatar } from '@/components/Avatar'
import { Button, ErrorState, Loading, Row, Section, TextField } from '@/components/ui'
import { MessageText } from '@/components/MessageText'
import { ProfileBanner } from '@/features/account/ProfileBanner'
import { openDmWith } from '@/features/friends/openDm'
import { relationWith } from '@/features/friends/relation'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk, queryClient } from '@/lib/queryClient'
import { useAuth } from '@/stores/auth'
import { colors, font, spacing } from '@/theme'

export default function UserScreen() {
  const { valid, ids } = useRouteParams(['userId'] as const)
  const me = useAuth((s) => s.user)
  const q = useQuery({ queryKey: qk.user(ids.userId ?? ''), queryFn: () => usersApi.get(ids.userId), enabled: valid })
  const accepted = useQuery({ queryKey: qk.friends('all'), queryFn: () => friendsApi.list('all') })
  const pending = useQuery({ queryKey: qk.friends('pending'), queryFn: () => friendsApi.list('pending') })
  const blocked = useQuery({ queryKey: qk.friends('blocked'), queryFn: () => friendsApi.list('blocked') })
  if (!valid) return <ErrorState message="Profil invalide." />
  if (q.isLoading) return <Loading />
  if (q.error || !q.data) return <ErrorState message={errorMessage(q.error, 'Profil introuvable')} onRetry={() => void q.refetch()} />
  const u = q.data
  const isMe = u.id === me?.id
  const relation = relationWith(u.id, [blocked.data?.friends, accepted.data?.friends, pending.data?.friends])

  const run = (fn: () => Promise<unknown>, ok: string) =>
    fn()
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: qk.friendsAll })
        Alert.alert(ok)
      })
      .catch((e) => Alert.alert('Action impossible', errorMessage(e)))

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl }} keyboardShouldPersistTaps="handled">
      <ProfileBanner uri={u.banner} name={u.username} />
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

      {!isMe ? <MutualServers userId={u.id} /> : null}
      {!isMe && relation.kind === 'friend' ? (
        <SavedText
          title="Surnom d’ami"
          footer="Visible de toi seul, à la place de son pseudo."
          queryKey={['friend-nickname', u.id]}
          load={() => friendsApi.nickname(u.id).then((r) => r.nickname)}
          save={(v) => friendsApi.setNickname(u.id, v).then(() => void queryClient.invalidateQueries({ queryKey: qk.friendsAll }))}
          maxLength={64}
        />
      ) : null}
      {!isMe ? (
        <SavedText
          title="Note"
          footer="Note privée : visible de toi seul."
          queryKey={['user-note', u.id]}
          load={() => usersApi.note(u.id).then((r) => r.content)}
          save={(v) => usersApi.setNote(u.id, v)}
          maxLength={2000}
          multiline
        />
      ) : null}

      {!isMe ? (
        <View style={{ gap: spacing.md }}>
          <Button title="Envoyer un message" icon="chatbubble" onPress={() => void openDmWith(u.id, u.username)} />
          {relation.kind === 'none' ? (
            <Button
              title="Ajouter en ami"
              icon="person-add"
              variant="secondary"
              onPress={() => run(() => friendsApi.addByName(`${u.username}#${u.discriminator}`), 'Demande d’ami envoyée')}
            />
          ) : relation.kind === 'received' ? (
            <Button
              title="Accepter la demande d’ami"
              icon="person-add"
              variant="secondary"
              onPress={() => run(() => friendsApi.accept(relation.friendshipId), 'Demande acceptée')}
            />
          ) : relation.kind === 'sent' ? (
            <Text style={styles.relation}>Demande d’ami envoyée</Text>
          ) : relation.kind === 'friend' ? (
            <Text style={styles.relation}>Vous êtes amis</Text>
          ) : null}
          {relation.kind === 'blocked' ? (
            <Button
              title="Débloquer"
              icon="ban"
              variant="ghost"
              onPress={() => run(() => friendsApi.unblock(u.id), 'Utilisateur débloqué')}
            />
          ) : (
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
          )}
        </View>
      ) : (
        <Button title="Modifier mon profil" onPress={() => router.push('/settings/profile')} />
      )}
    </ScrollView>
  )
}

function MutualServers({ userId }: { userId: string }) {
  const q = useQuery({ queryKey: ['mutual-servers', userId], queryFn: () => usersApi.mutualServers(userId) })
  if (!q.data?.length) return null
  return (
    <Section title={`Serveurs en commun (${q.data.length})`}>
      {q.data.map((s) => (
        <Row
          key={s.id}
          title={s.name}
          subtitle={s.member_role_names.length ? s.member_role_names.join(', ') : null}
          right={<Avatar uri={s.icon} name={s.name} size={28} rounded={false} />}
        />
      ))}
    </Section>
  )
}

/** Champ texte privé enregistré côté serveur (note, surnom d'ami). */
function SavedText({
  title,
  footer,
  queryKey,
  load,
  save,
  maxLength,
  multiline,
}: {
  title: string
  footer: string
  queryKey: string[]
  load: () => Promise<string>
  save: (v: string) => Promise<unknown>
  maxLength: number
  multiline?: boolean
}) {
  const q = useQuery({ queryKey, queryFn: load })
  /** null tant que rien n'est tapé : on affiche la valeur du serveur. */
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (q.data === undefined) return null
  const value = draft ?? q.data
  const submit = async () => {
    setBusy(true)
    try {
      await save(value.trim())
      queryClient.setQueryData(queryKey, value.trim())
      setDraft(null)
    } catch (e) {
      Alert.alert('Enregistrement impossible', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section title={title} footer={footer}>
      <View style={{ padding: spacing.md, gap: spacing.sm }}>
        <TextField
          accessibilityLabel={title}
          value={value}
          onChangeText={setDraft}
          maxLength={maxLength}
          multiline={multiline}
          style={multiline ? { minHeight: 80, textAlignVertical: 'top' } : undefined}
        />
        {value.trim() !== q.data ? <Button title="Enregistrer" variant="secondary" onPress={() => void submit()} loading={busy} /> : null}
      </View>
    </Section>
  )
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: 4, marginBottom: spacing.xl },
  name: { color: colors.text, fontSize: font.xxl, fontWeight: '800', marginTop: spacing.md },
  tag: { color: colors.textMuted },
  status: { color: colors.textSecondary, marginTop: spacing.sm },
  relation: { color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.sm },
})
