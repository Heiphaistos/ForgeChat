import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { messagesApi } from '@/api/messages'
import { Button, ErrorState, Row, Section, TextField } from '@/components/ui'
import { formatReminderInput, parseReminderInput, reminderPresets } from '@/features/chat/messageExtras'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { colors, font, spacing } from '@/theme'

/** « Me le rappeler » (comme ReminderModal) : le serveur renvoie un événement REMINDER à l'échéance. */
export default function RemindScreen() {
  const { valid, ids } = useRouteParams(['messageId'] as const)
  const [custom, setCustom] = useState(() => formatReminderInput(new Date(Date.now() + 60 * 60_000)))
  const [busy, setBusy] = useState(false)
  if (!valid) return <ErrorState message="Message invalide." />

  const schedule = (date: Date) => {
    setBusy(true)
    messagesApi
      .remind(ids.messageId, date)
      .then(() => {
        Alert.alert('Rappel programmé', `Le ${formatReminderInput(date)}`)
        router.back()
      })
      .catch((e) => Alert.alert('Rappel impossible', errorMessage(e)))
      .finally(() => setBusy(false))
  }

  const scheduleCustom = () => {
    const date = parseReminderInput(custom, new Date())
    if (date) schedule(date)
    else Alert.alert('Date invalide', 'Format JJ/MM/AAAA HH:MM, dans le futur.')
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
      <Section title="Me le rappeler">
        {reminderPresets(new Date()).map((p) => (
          <Row key={p.label} icon="alarm-outline" title={p.label} subtitle={formatReminderInput(p.date)} onPress={() => !busy && schedule(p.date)} />
        ))}
      </Section>
      <View style={{ gap: spacing.sm }}>
        <TextField
          label="Date et heure"
          value={custom}
          onChangeText={setCustom}
          placeholder="JJ/MM/AAAA HH:MM"
          accessibilityLabel="Date et heure du rappel, format jour mois année heure minutes"
          keyboardType="numbers-and-punctuation"
          autoCorrect={false}
          onSubmitEditing={scheduleCustom}
        />
        <Text style={styles.hint}>Heure de ton téléphone. Le rappel s’affiche quand l’application est ouverte.</Text>
        <Button title="Programmer" icon="alarm-outline" loading={busy} onPress={scheduleCustom} />
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  hint: { color: colors.textMuted, fontSize: font.xs },
})
