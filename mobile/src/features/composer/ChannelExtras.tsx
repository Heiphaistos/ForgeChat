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
import { errorMessage } from '@/lib/http'
import { colors, font, radius, spacing } from '@/theme'

/** Feuille plein contenu au-dessus du clavier (formulaires de la barre de saisie). */
export function FormSheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Fermer" />
        <View style={[styles.panel, { paddingBottom: insets.bottom + spacing.sm }]}>
          <View style={styles.titleRow}>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            <IconButton icon="close" label="Fermer" onPress={onClose} />
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
    onError: (e) => Alert.alert('Sondage impossible', errorMessage(e)),
  })
  const setOption = (i: number, v: string) => setOptions((prev) => prev.map((o, j) => (j === i ? v : o)))
  return (
    <FormSheet visible={visible} onClose={onClose} title="Nouveau sondage">
      <TextField label="Question" value={question} onChangeText={setQuestion} maxLength={POLL_QUESTION_MAX} placeholder="Que voulez-vous demander ?" />
      {options.map((o, i) => (
        <View key={i} style={styles.optionRow}>
          <View style={{ flex: 1 }}>
            <TextField
              label={`Option ${i + 1}`}
              value={o}
              onChangeText={(v) => setOption(i, v)}
              maxLength={POLL_OPTION_MAX_CHARS}
              accessibilityLabel={`Option ${i + 1}`}
            />
          </View>
          {options.length > 2 ? (
            <IconButton icon="trash-outline" label={`Retirer l’option ${i + 1}`} onPress={() => setOptions((prev) => prev.filter((_, j) => j !== i))} />
          ) : null}
        </View>
      ))}
      {options.length < POLL_OPTIONS_MAX ? (
        <Button title="Ajouter une option" variant="ghost" icon="add" onPress={() => setOptions((prev) => [...prev, ''])} />
      ) : null}
      <Section>
        <SwitchRow icon="checkbox-outline" title="Choix multiple" value={multiple} onValueChange={setMultiple} />
      </Section>
      <Text style={styles.label}>Durée</Text>
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
              <Text style={[styles.chipText, on && { color: colors.text }]}>{d.label}</Text>
            </Pressable>
          )
        })}
      </View>
      <Button title="Publier le sondage" icon="stats-chart-outline" loading={create.isPending} onPress={() => create.mutate()} />
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
    onError: (e) => Alert.alert('Programmation impossible', errorMessage(e)),
  })
  const cancel = useMutation({
    mutationFn: (id: string) => messagesApi.cancelScheduled(id),
    onSuccess: () => void list.refetch(),
    onError: (e) => Alert.alert('Annulation impossible', errorMessage(e)),
  })
  const text = content.trim()
  const tooLong = text.length > LIMITS.messageMaxChars
  return (
    <FormSheet visible={visible} onClose={onClose} title="Messages programmés">
      {text ? (
        <>
          <View style={styles.preview}>
            <Text style={styles.label}>Message à programmer</Text>
            <Text style={{ color: colors.textSecondary }} numberOfLines={4}>
              {text}
            </Text>
          </View>
          {tooLong ? <Text style={{ color: colors.danger }}>Message trop long ({LIMITS.messageMaxChars} caractères max).</Text> : null}
          <Section title="Envoyer">
            {reminderPresets(new Date()).map((p) => (
              <Row key={p.label} icon="time-outline" title={p.label} subtitle={formatReminderInput(p.date)} onPress={() => !schedule.isPending && !tooLong && schedule.mutate(p.date)} />
            ))}
          </Section>
          <TextField
            label="Date et heure"
            value={custom}
            onChangeText={setCustom}
            placeholder="JJ/MM/AAAA HH:MM"
            accessibilityLabel="Date et heure d’envoi, format jour mois année heure minutes"
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
          />
          <Button
            title="Programmer"
            icon="calendar-outline"
            loading={schedule.isPending}
            disabled={tooLong}
            onPress={() => schedule.mutate(parseReminderInput(custom, new Date()))}
          />
        </>
      ) : (
        <Text style={styles.hint}>Écris un message puis choisis « Programmer » pour l’envoyer plus tard (30 jours au plus).</Text>
      )}
      <Text style={styles.label}>En attente</Text>
      {list.isLoading ? (
        <Text style={styles.hint}>Chargement…</Text>
      ) : list.error ? (
        <Text style={{ color: colors.danger }}>{errorMessage(list.error)}</Text>
      ) : !list.data?.length ? (
        <Text style={styles.hint}>Aucun message programmé dans ce salon.</Text>
      ) : (
        <Section>
          {list.data.map((s) => (
            <Row
              key={s.id}
              icon="calendar-outline"
              title={s.content}
              subtitle={`Le ${formatReminderInput(new Date(s.sendAt))}`}
              right={<IconButton icon="close-circle-outline" label="Annuler ce message programmé" onPress={() => cancel.mutate(s.id)} disabled={cancel.isPending} />}
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
