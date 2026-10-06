import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Alert, ScrollView, View } from 'react-native'
import { emailPrefsKey, settingsApi, settingsKey, type ServerSideSettings } from '@/api/settings'
import { usersApi } from '@/api/users'
import { Button, Row, Section, SwitchRow, TextField } from '@/components/ui'
import { PUSH_AVAILABLE } from '@/config/env'
import { isHHMM, toHHMM } from '@/features/account/rules'
import { errorMessage } from '@/lib/http'
import { queryClient } from '@/lib/queryClient'
import { useAuth } from '@/stores/auth'
import { useSettings } from '@/stores/settings'
import { colors, spacing } from '@/theme'

export default function NotificationSettings() {
  const s = useSettings()
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
      {PUSH_AVAILABLE ? (
        <Section
          title="Notifications push"
          footer="Envoyées quand l'app est fermée ou en arrière-plan : messages privés, mentions et appels manqués."
        >
          <SwitchRow icon="notifications-outline" title="Activer les notifications" value={s.pushEnabled} onValueChange={(v) => s.set({ pushEnabled: v })} />
          <SwitchRow
            icon="eye-outline"
            title="Afficher le contenu des messages"
            subtitle="Désactivé : « Nouveau message de X » uniquement. Le contenu transite alors par Apple/Google."
            value={s.pushPreview}
            onValueChange={(v) => s.set({ pushPreview: v })}
            disabled={!s.pushEnabled}
          />
        </Section>
      ) : (
        <Section title="Notifications push" footer="En attendant, les messages et les appels arrivent quand l'app est ouverte.">
          <Row icon="notifications-off-outline" title="Pas encore disponibles" subtitle="Prévues dans une prochaine version de ForgeChat." />
        </Section>
      )}
      <FocusMode />
      <QuietHours />
      <EmailPrefs />
    </ScrollView>
  )
}

function FocusMode() {
  const focus = useAuth((st) => !!st.user?.focus_mode)
  const setUser = useAuth((st) => st.setUser)
  const toggle = async (v: boolean) => {
    setUser({ focus_mode: v })
    try {
      await usersApi.setFocusMode(v)
    } catch (e) {
      setUser({ focus_mode: !v })
      Alert.alert('Mode focus non modifié', errorMessage(e))
    }
  }
  return (
    <Section footer="Coupe les notifications de ton compte sur tous tes appareils, le temps de te concentrer.">
      <SwitchRow icon="moon-outline" title="Mode focus" value={focus} onValueChange={(v) => void toggle(v)} />
    </Section>
  )
}

function QuietHours() {
  const q = useQuery({ queryKey: settingsKey, queryFn: settingsApi.get })
  const [draft, setDraft] = useState<{ start: string; end: string } | null>(null)
  const save = useMutation({
    mutationFn: (patch: Partial<ServerSideSettings>) => settingsApi.update(patch),
    onSuccess: (data) => {
      queryClient.setQueryData(settingsKey, data)
      setDraft(null)
    },
    onError: (e) => Alert.alert('Heures calmes non enregistrées', errorMessage(e)),
  })
  if (!q.data) return null
  const enabled = q.data.quiet_hours_enabled
  const start = draft?.start ?? toHHMM(q.data.quiet_hours_start, '22:00')
  const end = draft?.end ?? toHHMM(q.data.quiet_hours_end, '08:00')
  const valid = isHHMM(start) && isHHMM(end)
  const edit = (patch: Partial<{ start: string; end: string }>) => setDraft({ start, end, ...patch })

  return (
    <Section title="Heures calmes" footer="Aucune notification pendant cette plage horaire (format 24 h, HH:MM).">
      <SwitchRow
        icon="bed-outline"
        title="Activer les heures calmes"
        value={enabled}
        disabled={save.isPending || !valid}
        onValueChange={(v) => save.mutate({ quiet_hours_enabled: v, quiet_hours_start: start.trim(), quiet_hours_end: end.trim() })}
      />
      {enabled ? (
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <TextField label="Début" value={start} onChangeText={(t) => edit({ start: t })} keyboardType="numbers-and-punctuation" maxLength={5} />
            </View>
            <View style={{ flex: 1 }}>
              <TextField label="Fin" value={end} onChangeText={(t) => edit({ end: t })} keyboardType="numbers-and-punctuation" maxLength={5} />
            </View>
          </View>
          {draft ? (
            <Button
              title={valid ? 'Enregistrer la plage' : 'Heures au format HH:MM'}
              disabled={!valid}
              loading={save.isPending}
              onPress={() => save.mutate({ quiet_hours_start: start.trim(), quiet_hours_end: end.trim() })}
            />
          ) : null}
        </View>
      ) : null}
    </Section>
  )
}

function EmailPrefs() {
  const q = useQuery({ queryKey: emailPrefsKey, queryFn: settingsApi.emailPrefs })
  const save = useMutation({
    mutationFn: settingsApi.setEmailPrefs,
    onSuccess: (data) => queryClient.setQueryData(emailPrefsKey, data),
    onError: (e) => Alert.alert('Préférence non enregistrée', errorMessage(e)),
  })
  if (!q.data) return null
  return (
    <Section title="E-mails">
      <SwitchRow
        icon="mail-outline"
        title="Messages privés non lus"
        subtitle="Recevoir un e-mail quand des messages privés restent non lus."
        value={save.isPending && save.variables !== undefined ? save.variables : q.data.dm_unread_notify}
        disabled={save.isPending}
        onValueChange={(v) => save.mutate(v)}
      />
    </Section>
  )
}
