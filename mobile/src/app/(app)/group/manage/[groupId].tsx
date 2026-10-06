import { useMutation, useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, View } from 'react-native'
import { dmsApi } from '@/api/dms'
import { friendsApi } from '@/api/friends'
import { Avatar } from '@/components/Avatar'
import { Button, ErrorState, IconButton, Loading, Row, Section, TextField } from '@/components/ui'
import { GROUP_MAX_MEMBERS, GROUP_NAME_MAX, addableFriends, canAddMember, canRemoveMember, normalizeGroupName } from '@/features/groups/rules'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk, queryClient } from '@/lib/queryClient'
import { getMyId } from '@/stores/auth'
import { colors, spacing } from '@/theme'

export default function ManageGroupScreen() {
  const { valid, ids } = useRouteParams(['groupId'] as const)
  const groupId = ids.groupId ?? ''
  const group = useQuery({ queryKey: qk.group(groupId), queryFn: () => dmsApi.group(groupId), enabled: valid })
  const friends = useQuery({ queryKey: qk.friends('all'), queryFn: () => friendsApi.list('all'), enabled: valid })
  /** null tant que l'utilisateur n'a rien tapé : on affiche alors le nom du serveur. */
  const [draft, setDraft] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: qk.group(groupId) })
    void queryClient.invalidateQueries({ queryKey: qk.conversations })
  }
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: refresh,
    onError: (e) => Alert.alert('Action impossible', errorMessage(e)),
  })

  if (!valid) return <ErrorState message="Lien de groupe invalide." />
  if (group.isLoading) return <Loading />
  if (group.error || !group.data) return <ErrorState message={errorMessage(group.error)} onRetry={() => void group.refetch()} />
  const g = group.data
  const myId = getMyId()
  const name = draft ?? g.name

  const rename = () => {
    const n = normalizeGroupName(name)
    if (!n) {
      setNameError('Le nom ne peut pas être vide.')
      return
    }
    setNameError(null)
    act.mutate(() => dmsApi.renameGroup(groupId, n).then(() => setDraft(null)))
  }

  const remove = (userId: string, username: string) =>
    Alert.alert('Retirer du groupe ?', username, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Retirer', style: 'destructive', onPress: () => act.mutate(() => dmsApi.removeGroupMember(groupId, userId)) },
    ])

  const transfer = (userId: string, username: string) =>
    Alert.alert('Transférer la propriété ?', `${username} deviendra propriétaire du groupe. Tu resteras membre.`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Transférer', style: 'destructive', onPress: () => act.mutate(() => dmsApi.transferGroupOwner(groupId, userId)) },
    ])

  const leave = () =>
    Alert.alert('Quitter le groupe ?', g.name, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Quitter',
        style: 'destructive',
        onPress: () =>
          dmsApi
            .leaveGroup(groupId)
            .then(() => {
              void queryClient.invalidateQueries({ queryKey: qk.conversations })
              queryClient.removeQueries({ queryKey: qk.group(groupId) })
              router.dismissAll()
            })
            .catch((e) => Alert.alert('Erreur', errorMessage(e))),
      },
    ])

  const candidates = addableFriends(friends.data?.friends ?? [], g)
  const full = !canAddMember(g)

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ paddingVertical: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <View style={{ paddingHorizontal: spacing.xl, gap: spacing.sm }}>
        <TextField label="Nom du groupe" value={name} onChangeText={setDraft} maxLength={GROUP_NAME_MAX} error={nameError} />
        <Button title="Renommer" variant="secondary" onPress={rename} disabled={act.isPending || normalizeGroupName(name) === g.name} />
      </View>

      <Section title={`Membres (${g.members.length}/${GROUP_MAX_MEMBERS})`}>
        {g.members.map((m) => (
          <Row
            key={m.id}
            title={m.id === myId ? `${m.username} (toi)` : m.username}
            subtitle={m.id === g.owner_id ? 'Propriétaire' : null}
            right={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Avatar uri={m.avatar} name={m.username} size={28} userId={m.id} />
                {g.owner_id === myId && m.id !== myId ? (
                  <IconButton icon="ribbon-outline" label={`Transférer la propriété à ${m.username}`} onPress={() => transfer(m.id, m.username)} />
                ) : null}
                {canRemoveMember(g, myId, m.id) ? (
                  <IconButton icon="person-remove-outline" label={`Retirer ${m.username}`} color={colors.danger} onPress={() => remove(m.id, m.username)} />
                ) : null}
              </View>
            }
          />
        ))}
      </Section>

      <Section title="Ajouter des amis" footer={full ? `Le groupe est complet (${GROUP_MAX_MEMBERS} membres).` : undefined}>
        {!full && candidates.length === 0 ? <Row title="Aucun ami à ajouter" /> : null}
        {full
          ? null
          : candidates.map((f) => (
              <Row
                key={f.friend_id}
                title={f.custom_nickname ?? f.username}
                right={
                  <IconButton
                    icon="person-add-outline"
                    label={`Ajouter ${f.username}`}
                    color={colors.success}
                    disabled={act.isPending}
                    onPress={() => act.mutate(() => dmsApi.addGroupMember(groupId, f.friend_id))}
                  />
                }
              />
            ))}
      </Section>

      <Section>
        <Row icon="exit-outline" title="Quitter le groupe" danger onPress={leave} />
      </Section>
    </ScrollView>
  )
}
