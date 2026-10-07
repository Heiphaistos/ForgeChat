import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Alert, Platform, ScrollView, View } from 'react-native'
import { emailPrefsKey, settingsApi, settingsKey, type ServerSideSettings } from '@/api/settings'
import { usersApi } from '@/api/users'
import { Button, Row, Section, SwitchRow, TextField } from '@/components/ui'
import { PUSH_AVAILABLE } from '@/config/env'
import { isHHMM, toHHMM } from '@/features/account/rules'
import { keepConnectedEnabled } from '@/features/notifications/backgroundRules'
import { t as tr, useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { queryClient } from '@/lib/queryClient'
import { useKeepAlive } from '@/services/keepAlive'
import { useAuth } from '@/stores/auth'
import { useSettings } from '@/stores/settings'
import { colors, spacing } from '@/theme'

export default function NotificationSettings() {
  const s = useSettings()
  const t = useT()
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
      {PUSH_AVAILABLE ? (
        <Section
          title={t('settings.notifications.push')}
          footer={t('settings.notifications.pushFooter')}
        >
          <SwitchRow icon="notifications-outline" title={t('settings.notifications.enable')} value={s.pushEnabled} onValueChange={(v) => s.set({ pushEnabled: v })} />
          <SwitchRow
            icon="eye-outline"
            title={t('settings.notifications.showContent')}
            subtitle={t('settings.notifications.showContentSub')}
            value={s.pushPreview}
            onValueChange={(v) => s.set({ pushPreview: v })}
            disabled={!s.pushEnabled}
          />
        </Section>
      ) : Platform.OS === 'android' ? null : (
        <Section title={t('settings.notifications.push')} footer={t('settings.notifications.pushPendingFooter')}>
          <Row icon="notifications-off-outline" title={t('settings.notifications.pushPending')} subtitle={t('settings.notifications.pushPendingSub')} />
        </Section>
      )}
      {Platform.OS === 'android' ? <KeepConnected /> : null}
      <FocusMode />
      <QuietHours />
      <EmailPrefs />
    </ScrollView>
  )
}

/** Mode « Notifications sans Google » (services/keepAlive) : actif par défaut sans jeton push. */
function KeepConnected() {
  const s = useSettings()
  const t = useT()
  const hasPushToken = useKeepAlive((k) => k.hasPushToken)
  const on = keepConnectedEnabled(s.keepConnected, hasPushToken)
  return (
    <Section
      title={t('settings.notifications.noGoogle')}
      footer={t('settings.notifications.noGoogleFooter')}
    >
      <SwitchRow
        icon="radio-outline"
        title={t('settings.notifications.noGoogle')}
        subtitle={t('settings.notifications.noGoogleSub')}
        value={on}
        onValueChange={(v) => s.set({ keepConnected: v })}
      />
      {PUSH_AVAILABLE ? null : (
        <SwitchRow
          icon="eye-outline"
          title={t('settings.notifications.showContent')}
          subtitle={t('settings.notifications.showContentSubShort')}
          value={s.pushPreview}
          onValueChange={(v) => s.set({ pushPreview: v })}
          disabled={!on}
        />
      )}
    </Section>
  )
}

function FocusMode() {
  const t = useT()
  const focus = useAuth((st) => !!st.user?.focus_mode)
  const setUser = useAuth((st) => st.setUser)
  const toggle = async (v: boolean) => {
    setUser({ focus_mode: v })
    try {
      await usersApi.setFocusMode(v)
    } catch (e) {
      setUser({ focus_mode: !v })
      Alert.alert(tr('settings.notifications.focusFailed'), errorMessage(e))
    }
  }
  return (
    <Section footer={t('settings.notifications.focusFooter')}>
      <SwitchRow icon="moon-outline" title={t('settings.notifications.focus')} value={focus} onValueChange={(v) => void toggle(v)} />
    </Section>
  )
}

function QuietHours() {
  const t = useT()
  const q = useQuery({ queryKey: settingsKey, queryFn: settingsApi.get })
  const [draft, setDraft] = useState<{ start: string; end: string } | null>(null)
  const save = useMutation({
    mutationFn: (patch: Partial<ServerSideSettings>) => settingsApi.update(patch),
    onSuccess: (data) => {
      queryClient.setQueryData(settingsKey, data)
      setDraft(null)
    },
    onError: (e) => Alert.alert(tr('settings.notifications.quietFailed'), errorMessage(e)),
  })
  if (!q.data) return null
  const enabled = q.data.quiet_hours_enabled
  const start = draft?.start ?? toHHMM(q.data.quiet_hours_start, '22:00')
  const end = draft?.end ?? toHHMM(q.data.quiet_hours_end, '08:00')
  const valid = isHHMM(start) && isHHMM(end)
  const edit = (patch: Partial<{ start: string; end: string }>) => setDraft({ start, end, ...patch })

  return (
    <Section title={t('settings.notifications.quiet')} footer={t('settings.notifications.quietFooter')}>
      <SwitchRow
        icon="bed-outline"
        title={t('settings.notifications.quietEnable')}
        value={enabled}
        disabled={save.isPending || !valid}
        onValueChange={(v) => save.mutate({ quiet_hours_enabled: v, quiet_hours_start: start.trim(), quiet_hours_end: end.trim() })}
      />
      {enabled ? (
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <TextField label={t('settings.notifications.start')} value={start} onChangeText={(v) => edit({ start: v })} keyboardType="numbers-and-punctuation" maxLength={5} />
            </View>
            <View style={{ flex: 1 }}>
              <TextField label={t('settings.notifications.end')} value={end} onChangeText={(v) => edit({ end: v })} keyboardType="numbers-and-punctuation" maxLength={5} />
            </View>
          </View>
          {draft ? (
            <Button
              title={t(valid ? 'settings.notifications.saveRange' : 'settings.notifications.invalidRange')}
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
  const t = useT()
  const q = useQuery({ queryKey: emailPrefsKey, queryFn: settingsApi.emailPrefs })
  const save = useMutation({
    mutationFn: settingsApi.setEmailPrefs,
    onSuccess: (data) => queryClient.setQueryData(emailPrefsKey, data),
    onError: (e) => Alert.alert(tr('settings.notifications.prefFailed'), errorMessage(e)),
  })
  if (!q.data) return null
  return (
    <Section title={t('settings.notifications.emails')}>
      <SwitchRow
        icon="mail-outline"
        title={t('settings.notifications.dmUnread')}
        subtitle={t('settings.notifications.dmUnreadSub')}
        value={save.isPending && save.variables !== undefined ? save.variables : q.data.dm_unread_notify}
        disabled={save.isPending}
        onValueChange={(v) => save.mutate(v)}
      />
    </Section>
  )
}
