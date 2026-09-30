import { useQuery } from '@tanstack/react-query'
import { Stack, router } from 'expo-router'
import { Alert, Text, View } from 'react-native'
import { dmsApi } from '@/api/dms'
import { ErrorState, IconButton } from '@/components/ui'
import { ChatView } from '@/features/chat/ChatView'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk, queryClient } from '@/lib/queryClient'
import { colors, font } from '@/theme'

export default function GroupScreen() {
  const { valid, ids, text } = useRouteParams(['groupId'] as const, ['name'])
  const group = useQuery({ queryKey: qk.group(ids.groupId ?? ''), queryFn: () => dmsApi.group(ids.groupId), enabled: valid })
  if (!valid) return <ErrorState message="Lien de groupe invalide." />
  const name = group.data?.name ?? text.name ?? 'Groupe'

  const leave = () =>
    Alert.alert('Quitter le groupe ?', name, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Quitter',
        style: 'destructive',
        onPress: () =>
          dmsApi
            .leaveGroup(ids.groupId)
            .then(() => {
              void queryClient.invalidateQueries({ queryKey: qk.conversations })
              router.back()
            })
            .catch((e) => Alert.alert('Erreur', errorMessage(e))),
      },
    ])

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: font.md }} numberOfLines={1}>
                {name}
              </Text>
              {group.data ? <Text style={{ color: colors.textMuted, fontSize: font.xs }}>{group.data.members.length} membres</Text> : null}
            </View>
          ),
          headerRight: () => (
            <IconButton
              icon="ellipsis-horizontal"
              label="Options du groupe"
              onPress={() =>
                Alert.alert(name, group.data?.members.map((m) => m.username).join(', '), [
                  { text: 'Quitter le groupe', style: 'destructive', onPress: leave },
                  { text: 'Fermer', style: 'cancel' },
                ])
              }
            />
          ),
        }}
      />
      <ChatView conversation={{ kind: 'group', groupId: ids.groupId }} placeholder={`Message dans ${name}`} />
    </>
  )
}
