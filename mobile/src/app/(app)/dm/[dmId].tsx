import { useQuery } from '@tanstack/react-query'
import { Stack, router } from 'expo-router'
import { Alert, Text, View } from 'react-native'
import { dmsApi } from '@/api/dms'
import { Avatar } from '@/components/Avatar'
import { ErrorState, IconButton } from '@/components/ui'
import { ChatView } from '@/features/chat/ChatView'
import { pinsParams } from '@/features/chat/pins'
import { errorMessage } from '@/lib/http'
import { isUuid, useRouteParams } from '@/lib/params'
import { qk } from '@/lib/queryClient'
import { useCall, type CallType } from '@/stores/call'
import { useGroupCall } from '@/stores/groupCall'
import { usePresenceOf } from '@/stores/presence'
import { useVoice } from '@/stores/voice'
import { colors, font } from '@/theme'

const STATUS_LABEL: Record<string, string> = { online: 'En ligne', away: 'Absent', idle: 'Absent', dnd: 'Ne pas déranger' }

export default function DmScreen() {
  const { valid, ids, text } = useRouteParams(['dmId'] as const, ['name', 'userId'])
  const convs = useQuery({ queryKey: qk.conversations, queryFn: dmsApi.list, enabled: valid })
  const summary = convs.data?.find((c) => c.id === ids.dmId && !c.is_group)
  const otherId = summary && !summary.is_group ? summary.other_user_id : isUuid(text.userId) ? text.userId : undefined
  const name = summary && !summary.is_group ? summary.username : (text.name ?? 'Message privé')
  const status = usePresenceOf(otherId, summary && !summary.is_group ? summary.status : undefined)
  const startCall = useCall((s) => s.start)

  if (!valid) return <ErrorState message="Lien de conversation invalide." />

  const call = async (type: CallType) => {
    if (!otherId) return
    if (useVoice.getState().channelId) {
      Alert.alert('Déjà en vocal', 'Quitte le salon vocal avant de lancer un appel.')
      return
    }
    if (useGroupCall.getState().groupId) {
      Alert.alert('Appel de groupe en cours', 'Quitte l’appel de groupe avant de lancer un appel.')
      return
    }
    try {
      await startCall(ids.dmId, otherId, name, type, summary && !summary.is_group ? summary.avatar : null)
      router.push('/call')
    } catch (e) {
      Alert.alert('Appel impossible', errorMessage(e))
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Avatar uri={summary && !summary.is_group ? summary.avatar : null} name={name} size={28} userId={otherId} showStatus={!!otherId} status={status} />
              <View>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: font.md }} numberOfLines={1}>
                  {name}
                </Text>
                {STATUS_LABEL[status] ? <Text style={{ color: colors.textMuted, fontSize: font.xs }}>{STATUS_LABEL[status]}</Text> : null}
              </View>
            </View>
          ),
          headerRight: () => (
            <View style={{ flexDirection: 'row' }}>
              <IconButton
                icon="pin-outline"
                label="Messages épinglés"
                onPress={() => router.push({ pathname: '/pins', params: pinsParams({ kind: 'dm', dmId: ids.dmId }) })}
              />
              {otherId ? (
                <>
                  <IconButton icon="call-outline" label="Appel vocal" onPress={() => void call('voice')} />
                  <IconButton icon="videocam-outline" label="Appel vidéo" onPress={() => void call('video')} />
                </>
              ) : null}
            </View>
          ),
        }}
      />
      <ChatView
        conversation={{ kind: 'dm', dmId: ids.dmId, otherUserId: otherId }}
        placeholder={`Envoyer un message à @${name}`}
        header={
          <View style={{ padding: 16, gap: 8 }}>
            <Avatar uri={summary && !summary.is_group ? summary.avatar : null} name={name} size={72} />
            <Text style={{ color: colors.text, fontSize: font.xl, fontWeight: '800' }}>{name}</Text>
            <Text style={{ color: colors.textMuted }}>C’est le début de ta conversation privée avec {name}.</Text>
          </View>
        }
      />
    </>
  )
}
