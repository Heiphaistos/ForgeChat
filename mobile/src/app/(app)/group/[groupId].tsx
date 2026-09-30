import { useQuery } from '@tanstack/react-query'
import { Stack, router } from 'expo-router'
import { Text, View } from 'react-native'
import { dmsApi } from '@/api/dms'
import { ErrorState, IconButton } from '@/components/ui'
import { ChatView } from '@/features/chat/ChatView'
import { pinsParams } from '@/features/chat/pins'
import { useRouteParams } from '@/lib/params'
import { qk } from '@/lib/queryClient'
import { colors, font } from '@/theme'

export default function GroupScreen() {
  const { valid, ids, text } = useRouteParams(['groupId'] as const, ['name'])
  const group = useQuery({ queryKey: qk.group(ids.groupId ?? ''), queryFn: () => dmsApi.group(ids.groupId), enabled: valid })
  if (!valid) return <ErrorState message="Lien de groupe invalide." />
  const name = group.data?.name ?? text.name ?? 'Groupe'

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
            <View style={{ flexDirection: 'row' }}>
              <IconButton
                icon="pin-outline"
                label="Messages épinglés"
                onPress={() => router.push({ pathname: '/pins', params: pinsParams({ kind: 'group', groupId: ids.groupId }) })}
              />
              <IconButton
                icon="people-outline"
                label="Gérer le groupe"
                onPress={() => router.push({ pathname: '/group/manage/[groupId]', params: { groupId: ids.groupId } })}
              />
            </View>
          ),
        }}
      />
      <ChatView conversation={{ kind: 'group', groupId: ids.groupId }} placeholder={`Message dans ${name}`} />
    </>
  )
}
