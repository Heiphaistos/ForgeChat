// Réglages de discussion d'un salon textuel : messages éphémères et fils automatiques,
// enregistrés aussitôt (PUT …/messaging, droit de modifier les salons).
import { useState } from 'react'
import { Alert } from 'react-native'
import { messagingApi } from '@/api/messaging'
import { Section, SwitchRow } from '@/components/ui'
import { disappearChoices } from '@/features/chat/messaging'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { ChoiceRow } from './ChoiceRow'

export function ChannelMessagingSection({ serverId, channelId, disappearSeconds, autoThreads }: {
  serverId: string
  channelId: string
  disappearSeconds?: number | null
  autoThreads?: boolean
}) {
  const t = useT()
  const [disappear, setDisappear] = useState<number | null>(disappearSeconds ?? null)
  const [threads, setThreads] = useState(!!autoThreads)
  const save = (body: { disappear_seconds?: number | null; auto_threads?: boolean }, undo: () => void) =>
    void messagingApi
      .setChannelMessaging(serverId, channelId, body)
      .then(() => queryClient.invalidateQueries({ queryKey: qk.channels(serverId) }))
      .catch((e) => {
        undo()
        Alert.alert(t('messaging.disappear.failed'), errorMessage(e))
      })
  return (
    <Section title={t('messaging.channel.title')} footer={t('messaging.disappear.hint')}>
      <ChoiceRow
        icon="timer-outline"
        title={t('messaging.disappear.title')}
        value={disappear}
        options={disappearChoices('channel').map((c) => ({ value: c.value, label: t(c.label) }))}
        onChange={(v) => {
          const before = disappear
          setDisappear(v)
          save({ disappear_seconds: v }, () => setDisappear(before))
        }}
      />
      <SwitchRow
        icon="chatbubbles-outline"
        title={t('messaging.autothread.setting')}
        subtitle={t('messaging.autothread.hint')}
        value={threads}
        onValueChange={(v) => {
          setThreads(v)
          save({ auto_threads: v }, () => setThreads(!v))
        }}
      />
    </Section>
  )
}
