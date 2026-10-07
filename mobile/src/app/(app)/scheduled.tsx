import { useMutation, useQuery } from '@tanstack/react-query'
import { Stack, router } from 'expo-router'
import { useState } from 'react'
import { Alert, Modal, ScrollView, StyleSheet, Text, View } from 'react-native'
import { messagingApi } from '@/api/messaging'
import { messagesApi } from '@/api/messages'
import { Button, EmptyState, ErrorState, IconButton, Loading, TextField } from '@/components/ui'
import { e2eErrorText } from '@/e2e/conversations'
import { LIMITS } from '@/config/env'
import { formatReminderInput, parseReminderInput, scheduleDateError } from '@/features/chat/messageExtras'
import type { ScheduledEntry } from '@/features/chat/messaging'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { queryClient } from '@/lib/queryClient'
import { colors, font, radius, spacing } from '@/theme'

const KEY = ['scheduled-all'] as const

/** « À envoyer » : mes messages programmés (déchiffrés ici), à modifier, envoyer maintenant ou annuler. */
export default function ScheduledScreen() {
  const t = useT()
  const list = useQuery({ queryKey: KEY, queryFn: messagingApi.scheduledAll, refetchInterval: 60_000 })
  const [editing, setEditing] = useState<ScheduledEntry | null>(null)
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: KEY })
    void queryClient.invalidateQueries({ queryKey: ['scheduled'] })
  }
  const fail = (e: unknown) => Alert.alert(t('messaging.sched.failed'), e2eErrorText(e) ?? errorMessage(e))
  const sendNow = useMutation({ mutationFn: messagingApi.sendScheduledNow, onSuccess: refresh, onError: fail })
  const cancel = useMutation({ mutationFn: messagesApi.cancelScheduled, onSuccess: refresh, onError: fail })

  let body: React.ReactNode
  if (list.isLoading) body = <Loading />
  else if (list.error) body = <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
  else if (!list.data?.length) body = <EmptyState icon="calendar-outline" title={t('messaging.sched.none')} />
  else
    body = (
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        <Text style={styles.muted}>{t('messaging.sched.desc')}</Text>
        {list.data.map((s) => (
          <View key={s.id} style={styles.card}>
            <Text style={styles.muted} numberOfLines={1}
              onPress={() => router.push({ pathname: '/channel/[serverId]/[channelId]', params: { serverId: s.serverId, channelId: s.channelId } })}>
              {t('messaging.sched.where', { server: s.serverName, channel: s.channelName })} · {formatReminderInput(new Date(s.sendAt))}
            </Text>
            <Text style={[styles.text, s.locked && { fontStyle: 'italic', color: colors.textMuted }]}>{s.content}</Text>
            <View style={styles.actions}>
              <IconButton icon="create-outline" label={t('messaging.sched.edit')} onPress={() => setEditing(s)} />
              <IconButton icon="send-outline" label={t('messaging.sched.sendNow')} disabled={sendNow.isPending} onPress={() => sendNow.mutate(s.id)} />
              <IconButton icon="close-circle-outline" label={t('panel.schedule.cancel')} danger disabled={cancel.isPending} onPress={() => cancel.mutate(s.id)} />
            </View>
          </View>
        ))}
      </ScrollView>
    )

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: t('messaging.sched.title') }} />
      {body}
      {editing ? <EditScheduled entry={editing} onClose={() => setEditing(null)} onSaved={refresh} /> : null}
    </View>
  )
}

function EditScheduled({ entry, onClose, onSaved }: { entry: ScheduledEntry; onClose: () => void; onSaved: () => void }) {
  const t = useT()
  const [text, setText] = useState(entry.content)
  const [when, setWhen] = useState(formatReminderInput(new Date(entry.sendAt)))
  const save = useMutation({
    mutationFn: async () => {
      const at = parseReminderInput(when, new Date())
      const err = scheduleDateError(at, new Date())
      if (err) throw new Error(err)
      // Texte inchangé (ou illisible ici) : seule la date part ; sinon rechiffré.
      const changed = !entry.locked && text.trim() !== entry.content.trim()
      await messagingApi.updateScheduled(entry, changed ? text.trim() : null, at!)
    },
    onSuccess: () => {
      onSaved()
      onClose()
    },
    onError: (e) => Alert.alert(t('messaging.sched.failed'), e2eErrorText(e) ?? errorMessage(e)),
  })
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.box}>
          <TextField label={t('messaging.sched.edit')} value={text} onChangeText={setText} multiline editable={!entry.locked}
            maxLength={LIMITS.messageMaxChars} style={{ minHeight: 90, textAlignVertical: 'top' }} />
          <TextField label={t('panel.schedule.dateTime')} value={when} onChangeText={setWhen} placeholder={t('panel.schedule.datePlaceholder')}
            keyboardType="numbers-and-punctuation" autoCorrect={false} />
          <View style={styles.row}>
            <Button title={t('common.cancel')} variant="secondary" onPress={onClose} />
            <Button title={t('messaging.sched.save')} loading={save.isPending} disabled={!text.trim()} onPress={() => save.mutate()} />
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  muted: { color: colors.textMuted, fontSize: font.sm },
  text: { color: colors.text, fontSize: font.md },
  card: { backgroundColor: colors.bgAlt, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.lg },
  box: { backgroundColor: colors.bgElevated, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
})
