import { useQuery } from '@tanstack/react-query'
import { Stack, router } from 'expo-router'
import { Alert, Text, View } from 'react-native'
import { dmsApi } from '@/api/dms'
import { ErrorState, IconButton } from '@/components/ui'
import { ChatView } from '@/features/chat/ChatView'
import { pinsParams } from '@/features/chat/pins'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk } from '@/lib/queryClient'
import { useCall } from '@/stores/call'
import { useGroupCall, type GroupCallType } from '@/stores/groupCall'
import { useVoice } from '@/stores/voice'
import { colors, font } from '@/theme'

export default function GroupScreen() {
  const { valid, ids, text } = useRouteParams(['groupId'] as const, ['name'])
  const group = useQuery({ queryKey: qk.group(ids.groupId ?? ''), queryFn: () => dmsApi.group(ids.groupId), enabled: valid })
  const inCall = useGroupCall((s) => s.active[ids.groupId ?? '']?.length ?? 0)
  if (!valid) return <ErrorState message="Lien de groupe invalide." />
  const name = group.data?.name ?? text.name ?? 'Groupe'

  const call = async (type: GroupCallType) => {
    if (useGroupCall.getState().groupId === ids.groupId) {
      router.push('/group-call')
      return
    }
    if (useCall.getState().phase !== 'idle') {
      Alert.alert('Appel en cours', 'Raccroche avant de lancer un appel de groupe.')
      return
    }
    useVoice.getState().leave()
    try {
      await useGroupCall.getState().join(ids.groupId, type, name)
      router.push('/group-call')
    } catch (e) {
      Alert.alert('Appel impossible', errorMessage(e))
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: font.md }} numberOfLines={1}>
                {name}
              </Text>
              {inCall ? (
                <Text style={{ color: colors.success, fontSize: font.xs }}>Appel en cours · {inCall} participant{inCall > 1 ? 's' : ''}</Text>
              ) : group.data ? (
                <Text style={{ color: colors.textMuted, fontSize: font.xs }}>{group.data.members.length} membres</Text>
              ) : null}
            </View>
          ),
          headerRight: () => (
            <View style={{ flexDirection: 'row' }}>
              <IconButton
                icon="pin-outline"
                label="Messages épinglés"
                onPress={() => router.push({ pathname: '/pins', params: pinsParams({ kind: 'group', groupId: ids.groupId }) })}
              />
              <IconButton icon="search-outline" label="Rechercher dans la conversation" onPress={() => router.push({ pathname: '/search', params: pinsParams({ kind: 'group', groupId: ids.groupId }) })} />
              <IconButton icon="call-outline" label={inCall ? 'Rejoindre l’appel de groupe' : 'Appel vocal de groupe'} onPress={() => void call('voice')} />
              <IconButton icon="videocam-outline" label={inCall ? 'Rejoindre l’appel avec la caméra' : 'Appel vidéo de groupe'} onPress={() => void call('video')} />
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
