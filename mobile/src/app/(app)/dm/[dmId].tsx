import { useQuery } from '@tanstack/react-query'
import { Stack, router } from 'expo-router'
import { Alert, Text, View } from 'react-native'
import { dmsApi } from '@/api/dms'
import { Avatar } from '@/components/Avatar'
import { ErrorState, IconButton } from '@/components/ui'
import { ChatView } from '@/features/chat/ChatView'
import { pinsParams } from '@/features/chat/pins'
import { E2EBadge } from '@/e2e/E2EBadge'
import { useT, type Key } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { isUuid, useRouteParams } from '@/lib/params'
import { qk } from '@/lib/queryClient'
import { useCall, type CallType } from '@/stores/call'
import { useGroupCall } from '@/stores/groupCall'
import { usePresenceOf } from '@/stores/presence'
import { useVoice } from '@/stores/voice'
import { colors, font } from '@/theme'

const STATUS_LABEL: Record<string, Key> = { online: 'status.online', away: 'status.away', idle: 'status.away', dnd: 'status.dnd' }

export default function DmScreen() {
  const t = useT()
  const { valid, ids, text } = useRouteParams(['dmId'] as const, ['name', 'userId'])
  const convs = useQuery({ queryKey: qk.conversations, queryFn: dmsApi.list, enabled: valid })
  const summary = convs.data?.find((c) => c.id === ids.dmId && !c.is_group)
  const otherId = summary && !summary.is_group ? summary.other_user_id : isUuid(text.userId) ? text.userId : undefined
  const name = summary && !summary.is_group ? summary.username : (text.name ?? t('conv.dmFallback'))
  const status = usePresenceOf(otherId, summary && !summary.is_group ? summary.status : undefined)
  const startCall = useCall((s) => s.start)

  if (!valid) return <ErrorState message={t('conv.invalidDm')} />

  const call = async (type: CallType) => {
    if (!otherId) return
    if (useVoice.getState().channelId) {
      Alert.alert(t('conv.alreadyInVoice'), t('conv.leaveVoiceFirst'))
      return
    }
    if (useGroupCall.getState().groupId) {
      Alert.alert(t('conv.groupCallActive'), t('conv.leaveGroupCallFirst'))
      return
    }
    try {
      await startCall(ids.dmId, otherId, name, type, summary && !summary.is_group ? summary.avatar : null)
      router.push('/call')
    } catch (e) {
      Alert.alert(t('conv.callFailed'), errorMessage(e))
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
                {STATUS_LABEL[status] ? <Text style={{ color: colors.textMuted, fontSize: font.xs }}>{t(STATUS_LABEL[status])}</Text> : null}
              </View>
            </View>
          ),
          headerRight: () => (
            <View style={{ flexDirection: 'row' }}>
              <E2EBadge kind="dm" id={ids.dmId} />
              <IconButton
                icon="pin-outline"
                label={t('conv.pins')}
                onPress={() => router.push({ pathname: '/pins', params: pinsParams({ kind: 'dm', dmId: ids.dmId }) })}
              />
              <IconButton icon="search-outline" label={t('conv.search')} onPress={() => router.push({ pathname: '/search', params: pinsParams({ kind: 'dm', dmId: ids.dmId }) })} />
              {otherId ? (
                <>
                  <IconButton icon="call-outline" label={t('conv.voiceCall')} onPress={() => void call('voice')} />
                  <IconButton icon="videocam-outline" label={t('conv.videoCall')} onPress={() => void call('video')} />
                </>
              ) : null}
            </View>
          ),
        }}
      />
      <ChatView
        conversation={{ kind: 'dm', dmId: ids.dmId, otherUserId: otherId }}
        placeholder={t('conv.dmPlaceholder', { name })}
        header={
          <View style={{ padding: 16, gap: 8 }}>
            <Avatar uri={summary && !summary.is_group ? summary.avatar : null} name={name} size={72} />
            <Text style={{ color: colors.text, fontSize: font.xl, fontWeight: '800' }}>{name}</Text>
            <Text style={{ color: colors.textMuted }}>{t('conv.dmStart', { name })}</Text>
          </View>
        }
      />
    </>
  )
}
