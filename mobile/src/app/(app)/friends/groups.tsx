// Groupes d'amis (lot « Profil et social ») : créer, renommer, trier, supprimer ;
// ouvert depuis un ami (`userId`), cocher les groupes où le ranger.
import { Ionicons } from '@expo/vector-icons'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, View } from 'react-native'
import { socialApi, socialKeys, type FriendGroup } from '@/api/social'
import { Button, ErrorState, IconButton, Loading, Row, Section, TextField } from '@/components/ui'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { isUuid, useRouteParams } from '@/lib/params'
import { colors, spacing } from '@/theme'

export default function FriendGroupsScreen() {
  const t = useT()
  const { text } = useRouteParams([] as const, ['userId', 'name'])
  const userId = isUuid(text.userId) ? text.userId : null
  const q = useQuery({ queryKey: socialKeys.groups, queryFn: socialApi.groups })
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: socialKeys.groups })
      void queryClient.invalidateQueries({ queryKey: qk.friendsAll })
    },
    onError: (e) => Alert.alert(t('soc.groups.error'), errorMessage(e)),
  })

  if (q.isLoading) return <Loading />
  if (q.error || !q.data) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
  const groups = [...q.data].sort((a, b) => a.position - b.position)
  const move = (i: number, d: -1 | 1) => {
    const ids = groups.map((g) => g.id)
    if (i + d < 0 || i + d >= ids.length) return
    const [x, y] = [ids[i]!, ids[i + d]!]
    ids[i] = y
    ids[i + d] = x
    run.mutate(() => socialApi.orderGroups(ids))
  }
  const toggle = (g: FriendGroup) => {
    if (!userId) return
    const on = g.member_ids.includes(userId)
    run.mutate(() => (on ? socialApi.removeFromGroup(g.id, userId) : socialApi.addToGroup(g.id, userId)))
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: userId && text.name ? t('soc.groups.for', { name: text.name }) : t('soc.groups.title') }} />
      <Section footer={groups.length === 0 ? t('soc.groups.empty') : undefined}>
        {groups.map((g, i) =>
          editing?.id === g.id ? (
            <View key={g.id} style={{ padding: spacing.md, gap: spacing.sm }}>
              <TextField value={editing.name} onChangeText={(v) => setEditing({ id: g.id, name: v })} maxLength={64} accessibilityLabel={t('soc.groups.rename')} autoFocus />
              <Button
                title={t('soc.groups.save')}
                disabled={!editing.name.trim()}
                onPress={() => {
                  run.mutate(() => socialApi.renameGroup(g.id, editing.name.trim()))
                  setEditing(null)
                }}
              />
            </View>
          ) : (
            <Row
              key={g.id}
              title={g.name}
              subtitle={`${g.member_ids.length}`}
              selected={userId ? g.member_ids.includes(userId) : undefined}
              onPress={userId ? () => toggle(g) : () => setEditing({ id: g.id, name: g.name })}
              right={
                userId ? (
                  g.member_ids.includes(userId) ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null
                ) : (
                  <View style={{ flexDirection: 'row' }}>
                    <IconButton icon="arrow-up" label={t('soc.groups.up')} onPress={() => move(i, -1)} />
                    <IconButton icon="arrow-down" label={t('soc.groups.down')} onPress={() => move(i, 1)} />
                    <IconButton
                      icon="trash-outline"
                      label={t('soc.groups.delete')}
                      color={colors.danger}
                      onPress={() =>
                        Alert.alert(t('soc.groups.delete'), g.name, [
                          { text: t('common.cancel'), style: 'cancel' },
                          { text: t('common.delete'), style: 'destructive', onPress: () => run.mutate(() => socialApi.deleteGroup(g.id)) },
                        ])
                      }
                    />
                  </View>
                )
              }
            />
          ),
        )}
      </Section>
      <Section title={t('soc.groups.create')}>
        <View style={{ padding: spacing.md, gap: spacing.sm }}>
          <TextField value={name} onChangeText={setName} placeholder={t('soc.groups.namePh')} maxLength={64} accessibilityLabel={t('soc.groups.namePh')} />
          <Button
            title={t('soc.groups.create')}
            disabled={!name.trim()}
            loading={run.isPending}
            onPress={() => {
              const n = name.trim()
              setName('')
              run.mutate(() => socialApi.createGroup(n))
            }}
          />
        </View>
      </Section>
    </ScrollView>
  )
}
