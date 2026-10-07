import { useQuery } from '@tanstack/react-query'
import { Stack, router } from 'expo-router'
import { Alert, Text, View } from 'react-native'
import { dmsApi } from '@/api/dms'
import { ErrorState, IconButton } from '@/components/ui'
import { ChatView } from '@/features/chat/ChatView'
import { pinsParams } from '@/features/chat/pins'
import { E2EBadge } from '@/e2e/E2EBadge'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk } from '@/lib/queryClient'
import { useCall } from '@/stores/call'
import { useGroupCall, type GroupCallType } from '@/stores/groupCall'
import { useVoice } from '@/stores/voice'
import { colors, font } from '@/theme'

export default function GroupScreen() {
  const t = useT()
  const { valid, ids, text } = useRouteParams(['groupId'] as const, ['name'])
  const group = useQuery({ queryKey: qk.group(ids.groupId ?? ''), queryFn: () => dmsApi.group(ids.groupId), enabled: valid })
  const inCall = useGroupCall((s) => s.active[ids.groupId ?? '']?.length ?? 0)
  if (!valid) return <ErrorState message={t('conv.invalidGroup')} />
  const name = group.data?.name ?? text.name ?? t('conv.groupFallback')

  const call = async (type: GroupCallType) => {
    if (useGroupCall.getState().groupId === ids.groupId) {
      router.push('/group-call')
      return
    }
    if (useCall.getState().phase !== 'idle') {
      Alert.alert(t('conv.callActive'), t('conv.hangUpFirst'))
      return
    }
    useVoice.getState().leave()
    try {
      await useGroupCall.getState().join(ids.groupId, type, name)
      router.push('/group-call')
    } catch (e) {
      Alert.alert(t('conv.callFailed'), errorMessage(e))
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
                <Text style={{ color: colors.success, fontSize: font.xs }}>{t(inCall > 1 ? 'conv.groupInCallMany' : 'conv.groupInCall', { n: inCall })}</Text>
              ) : group.data ? (
                <Text style={{ color: colors.textMuted, fontSize: font.xs }}>{t('conv.groupMembers', { n: group.data.members.length })}</Text>
              ) : null}
            </View>
          ),
          headerRight: () => (
            <View style={{ flexDirection: 'row' }}>
              <E2EBadge kind="group" id={ids.groupId} />
              <IconButton
                icon="pin-outline"
                label={t('conv.pins')}
                onPress={() => router.push({ pathname: '/pins', params: pinsParams({ kind: 'group', groupId: ids.groupId }) })}
              />
              <IconButton icon="search-outline" label={t('conv.search')} onPress={() => router.push({ pathname: '/search', params: pinsParams({ kind: 'group', groupId: ids.groupId }) })} />
              <IconButton icon="call-outline" label={t(inCall ? 'conv.joinGroupCall' : 'conv.groupVoiceCall')} onPress={() => void call('voice')} />
              <IconButton icon="videocam-outline" label={t(inCall ? 'conv.joinWithCamera' : 'conv.groupVideoCall')} onPress={() => void call('video')} />
              <IconButton
                icon="people-outline"
                label={t('conv.manageGroup')}
                onPress={() => router.push({ pathname: '/group/manage/[groupId]', params: { groupId: ids.groupId } })}
              />
            </View>
          ),
        }}
      />
      <ChatView conversation={{ kind: 'group', groupId: ids.groupId }} placeholder={t('conv.groupPlaceholder', { name })} />
    </>
  )
}
