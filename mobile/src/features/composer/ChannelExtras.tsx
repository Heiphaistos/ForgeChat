import { useMutation, useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { messagesApi } from '@/api/messages'
import { pollsApi } from '@/api/polls'
import { Button, IconButton, Row, Section, SwitchRow, TextField } from '@/components/ui'
import { LIMITS } from '@/config/env'
import { formatReminderInput, parseReminderInput, reminderPresets, scheduleDateError } from '@/features/chat/messageExtras'
import { POLL_DURATIONS, POLL_OPTION_MAX_CHARS, POLL_OPTIONS_MAX, POLL_QUESTION_MAX, pollBody } from '@/features/chat/polls'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { e2eErrorText } from '@/e2e/conversations'
import { colors, font, radius, spacing } from '@/theme'

/** Feuille plein contenu au-dessus du clavier (formulaires de la barre de saisie). */
export function FormSheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const insets = useSafeAreaInsets()
  const t = useT()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')} />
        <View style={[styles.panel, { paddingBottom: insets.bottom + spacing.sm }]}>
          <View style={styles.titleRow}>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            <IconButton icon="close" label={t('common.close')} onPress={onClose} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

/** Création d'un sondage (POST …/polls) : question, 2 à 10 options, choix multiple, durée. */
export function PollCreator({ visible, onClose, serverId, channelId }: { visible: boolean; onClose: () => void; serverId: string; channelId: string }) {
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [multiple, setMultiple] = useState(false)
  const [hours, setHours] = useState<number | null>(null)
  const t = useT()
  const create = useMutation({
    mutationFn: async () => {
      const body = pollBody(question, options, multiple, hours)
      if (typeof body === 'string') throw new Error(body)
      await pollsApi.create(serverId, channelId, body)
    },
    onSuccess: () => {
      setQuestion('')
      setOptions(['', ''])
      setMultiple(false)
      setHours(null)
      onClose()
    },
    onError: (e) => Alert.alert(t('panel.poll.failed'), e2eErrorText(e) ?? errorMessage(e)),
  })
  const setOption = (i: number, v: string) => setOptions((prev) => prev.map((o, j) => (j === i ? v : o)))
  return (
    <FormSheet visible={visible} onClose={onClose} title={t('panel.poll.new')}>
      <TextField
        label={t('panel.poll.question')}
        value={question}
        onChangeText={setQuestion}
        maxLength={POLL_QUESTION_MAX}
        placeholder={t('panel.poll.questionPlaceholder')}
      />
      {options.map((o, i) => (
        <View key={i} style={styles.optionRow}>
          <View style={{ flex: 1 }}>
            <TextField
              label={t('panel.poll.option', { n: i + 1 })}
              value={o}
              onChangeText={(v) => setOption(i, v)}
              maxLength={POLL_OPTION_MAX_CHARS}
              accessibilityLabel={t('panel.poll.option', { n: i + 1 })}
            />
          </View>
          {options.length > 2 ? (
            <IconButton icon="trash-outline" label={t('panel.poll.removeOption', { n: i + 1 })} onPress={() => setOptions((prev) => prev.filter((_, j) => j !== i))} />
          ) : null}
        </View>
      ))}
      {options.length < POLL_OPTIONS_MAX ? (
        <Button title={t('panel.poll.addOption')} variant="ghost" icon="add" onPress={() => setOptions((prev) => [...prev, ''])} />
      ) : null}
      <Section>
        <SwitchRow icon="checkbox-outline" title={t('panel.poll.multiple')} value={multiple} onValueChange={setMultiple} />
      </Section>
      <Text style={styles.label}>{t('panel.poll.duration')}</Text>
      <View style={styles.chips}>
        {POLL_DURATIONS.map((d) => {
          const on = hours === d.hours
          return (
            <Pressable
              key={d.label}
              onPress={() => setHours(d.hours)}
              style={[styles.chip, on && styles.chipOn]}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
            >
              <Text style={[styles.chipText, on && { color: colors.text }]}>{t(d.label)}</Text>
            </Pressable>
          )
        })}
      </View>
      <Button title={t('panel.poll.publish')} icon="stats-chart-outline" loading={create.isPending} onPress={() => create.mutate()} />
    </FormSheet>
  )
}

/**
 * Programmer le brouillon (POST …/scheduled, 30 jours au plus) et gérer mes messages programmés
 * du salon. `content` vide : seulement la liste.
 */
export function ScheduleSheet({
  visible,
  onClose,
  serverId,
  channelId,
  content,
  onScheduled,
  prepare,
}: {
  visible: boolean
  onClose: () => void
  serverId: string
  channelId: string
  content: string
  onScheduled: () => void
  /** Texte réellement envoyé (jetons des rôles choisis). */
  prepare: (text: string) => string
}) {
  const [custom, setCustom] = useState(() => formatReminderInput(new Date(Date.now() + 60 * 60_000)))
  const key = ['scheduled', channelId] as const
  const t = useT()
  const list = useQuery({ queryKey: key, queryFn: () => messagesApi.scheduled(serverId, channelId), enabled: visible })
  const schedule = useMutation({
    mutationFn: async (at: Date | null) => {
      const err = scheduleDateError(at, new Date())
      if (err) throw new Error(err)
      await messagesApi.schedule(serverId, channelId, prepare(content).trim(), at!)
    },
    onSuccess: () => {
      void list.refetch()
      onScheduled()
    },
    onError: (e) => Alert.alert(t('panel.schedule.failed'), e2eErrorText(e) ?? errorMessage(e)),
  })
  const cancel = useMutation({
    mutationFn: (id: string) => messagesApi.cancelScheduled(id),
    onSuccess: () => void list.refetch(),
    onError: (e) => Alert.alert(t('panel.schedule.cancelFailed'), errorMessage(e)),
  })
  const text = content.trim()
  const tooLong = text.length > LIMITS.messageMaxChars
  return (
    <FormSheet visible={visible} onClose={onClose} title={t('composer.scheduled')}>
      {text ? (
        <>
          <View style={styles.preview}>
            <Text style={styles.label}>{t('panel.schedule.preview')}</Text>
            <Text style={{ color: colors.textSecondary }} numberOfLines={4}>
              {text}
            </Text>
          </View>
          {tooLong ? <Text style={{ color: colors.danger }}>{t('panel.schedule.tooLong', { max: LIMITS.messageMaxChars })}</Text> : null}
          <Section title={t('composer.send')}>
            {reminderPresets(new Date()).map((p) => (
              <Row key={p.label} icon="time-outline" title={t(p.label)} subtitle={formatReminderInput(p.date)} onPress={() => !schedule.isPending && !tooLong && schedule.mutate(p.date)} />
            ))}
          </Section>
          <TextField
            label={t('panel.schedule.dateTime')}
            value={custom}
            onChangeText={setCustom}
            placeholder={t('panel.schedule.datePlaceholder')}
            accessibilityLabel={t('panel.schedule.dateA11y')}
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
          />
          <Button
            title={t('panel.schedule.submit')}
            icon="calendar-outline"
            loading={schedule.isPending}
            disabled={tooLong}
            onPress={() => schedule.mutate(parseReminderInput(custom, new Date()))}
          />
        </>
      ) : (
        <Text style={styles.hint}>{t('panel.schedule.hint')}</Text>
      )}
      <Text style={styles.label}>{t('panel.schedule.pending')}</Text>
      {list.isLoading ? (
        <Text style={styles.hint}>{t('panel.schedule.loading')}</Text>
      ) : list.error ? (
        <Text style={{ color: colors.danger }}>{errorMessage(list.error)}</Text>
      ) : !list.data?.length ? (
        <Text style={styles.hint}>{t('panel.schedule.empty')}</Text>
      ) : (
        <Section>
          {list.data.map((s) => (
            <Row
              key={s.id}
              icon="calendar-outline"
              title={s.content}
              subtitle={t('panel.schedule.at', { date: formatReminderInput(new Date(s.sendAt)) })}
              right={<IconButton icon="close-circle-outline" label={t('panel.schedule.cancel')} onPress={() => cancel.mutate(s.id)} disabled={cancel.isPending} />}
            />
          ))}
        </Section>
      )}
    </FormSheet>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  panel: { maxHeight: '88%', backgroundColor: colors.bgAlt, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: spacing.lg, paddingRight: spacing.sm, paddingTop: spacing.sm },
  title: { color: colors.text, fontSize: font.lg, fontWeight: '800' },
  label: { color: colors.textMuted, fontSize: font.xs, fontWeight: '700', textTransform: 'uppercase' },
  hint: { color: colors.textMuted, fontSize: font.sm },
  optionRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.lg, backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: 'transparent' },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primary + '33' },
  chipText: { color: colors.textMuted, fontSize: font.sm },
  preview: { backgroundColor: colors.bg, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs, borderLeftWidth: 3, borderLeftColor: colors.primary },
})
