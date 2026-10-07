import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { messagesApi } from '@/api/messages'
import { Button, ErrorState, Row, Section, TextField } from '@/components/ui'
import { formatReminderInput, parseReminderInput, reminderPresets } from '@/features/chat/messageExtras'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { colors, font, spacing } from '@/theme'

/** « Me le rappeler » (comme ReminderModal) : le serveur renvoie un événement REMINDER à l'échéance. */
export default function RemindScreen() {
  const t = useT()
  const { valid, ids } = useRouteParams(['messageId'] as const)
  const [custom, setCustom] = useState(() => formatReminderInput(new Date(Date.now() + 60 * 60_000)))
  const [busy, setBusy] = useState(false)
  if (!valid) return <ErrorState message={t('social.message.invalid')} />

  const schedule = (date: Date) => {
    setBusy(true)
    messagesApi
      .remind(ids.messageId, date)
      .then(() => {
        Alert.alert(t('social.remind.done'), t('social.remind.on', { date: formatReminderInput(date) }))
        router.back()
      })
      .catch((e) => Alert.alert(t('social.remind.failed'), errorMessage(e)))
      .finally(() => setBusy(false))
  }

  const scheduleCustom = () => {
    const date = parseReminderInput(custom, new Date())
    if (date) schedule(date)
    else Alert.alert(t('social.remind.badDate'), t('social.remind.badDateBody'))
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
      <Section title={t('screen.remind')}>
        {reminderPresets(new Date()).map((p) => (
          <Row key={p.label} icon="alarm-outline" title={t(p.label)} subtitle={formatReminderInput(p.date)} onPress={() => !busy && schedule(p.date)} />
        ))}
      </Section>
      <View style={{ gap: spacing.sm }}>
        <TextField
          label={t('social.remind.dateTime')}
          value={custom}
          onChangeText={setCustom}
          placeholder={t('social.remind.format')}
          accessibilityLabel={t('social.remind.dateTimeLabel')}
          keyboardType="numbers-and-punctuation"
          autoCorrect={false}
          onSubmitEditing={scheduleCustom}
        />
        <Text style={styles.hint}>{t('social.remind.hint')}</Text>
        <Button title={t('social.remind.schedule')} icon="alarm-outline" loading={busy} onPress={scheduleCustom} />
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  hint: { color: colors.textMuted, fontSize: font.xs },
})
