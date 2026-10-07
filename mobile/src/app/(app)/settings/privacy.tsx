import { Ionicons } from '@expo/vector-icons'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Stack, router } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, Share } from 'react-native'
import { settingsApi, settingsKey, type ServerSideSettings } from '@/api/settings'
import { usersApi } from '@/api/users'
import { ErrorState, Loading, Row, Section, SwitchRow } from '@/components/ui'
import { EXPORT_SHARE_MAX_CHARS } from '@/features/account/rules'
import { t as tr, useT, type Key } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { queryClient } from '@/lib/queryClient'
import { colors, spacing } from '@/theme'

type ChoiceKey = 'activity_visibility' | 'friend_request_from' | 'explicit_content_filter'

const CHOICES: { key: ChoiceKey; title: Key; options: { v: string; label: Key }[] }[] = [
  {
    key: 'activity_visibility',
    title: 'settings.privacy.activity',
    options: [
      { v: 'everyone', label: 'settings.privacy.everyone' },
      { v: 'friends', label: 'settings.privacy.friendsOnly' },
      { v: 'nobody', label: 'settings.privacy.nobody' },
    ],
  },
  {
    key: 'friend_request_from',
    title: 'settings.privacy.friendRequests',
    options: [
      { v: 'everyone', label: 'settings.privacy.everyone' },
      { v: 'friends_of_friends', label: 'settings.privacy.friendsOfFriends' },
      { v: 'nobody', label: 'settings.privacy.nobody' },
    ],
  },
  {
    key: 'explicit_content_filter',
    title: 'settings.privacy.contentFilter',
    options: [
      { v: 'none', label: 'settings.privacy.filterOff' },
      { v: 'members_without_roles', label: 'settings.privacy.filterNoRoles' },
      { v: 'all', label: 'settings.privacy.filterAll' },
    ],
  },
]

/** Confidentialité côté serveur (partagée avec le web et le bureau) + export RGPD. */
export default function PrivacyScreen() {
  const t = useT()
  const q = useQuery({ queryKey: settingsKey, queryFn: settingsApi.get })
  const [exporting, setExporting] = useState(false)
  const save = useMutation({
    mutationFn: (patch: Partial<ServerSideSettings>) => settingsApi.update(patch),
    onMutate: (patch) => queryClient.setQueryData<ServerSideSettings>(settingsKey, (old) => (old ? { ...old, ...patch } : old)),
    onSuccess: (data) => queryClient.setQueryData(settingsKey, data),
    onError: (e) => {
      void q.refetch()
      Alert.alert(tr('settings.privacy.saveFailed'), errorMessage(e))
    },
  })

  const exportData = async () => {
    setExporting(true)
    try {
      const text = JSON.stringify(await usersApi.dataExport(), null, 2)
      if (text.length > EXPORT_SHARE_MAX_CHARS) {
        Alert.alert(tr('settings.privacy.exportTooLarge'), tr('settings.privacy.exportTooLargeBody'))
        return
      }
      await Share.share({ title: 'forgechat-mes-donnees.json', message: text })
    } catch (e) {
      Alert.alert(tr('settings.privacy.exportFailed'), errorMessage(e))
    } finally {
      setExporting(false)
    }
  }

  if (q.isLoading) return <Loading />
  if (q.error || !q.data) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
  const s = q.data

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }}>
      <Stack.Screen options={{ title: t('settings.privacy.title') }} />
      <Section footer={t('settings.privacy.footer')}>
        <SwitchRow icon="radio-button-on-outline" title={t('settings.privacy.showOnline')} value={s.show_online} onValueChange={(v) => save.mutate({ show_online: v })} />
        <SwitchRow
          icon="chatbubbles-outline"
          title={t('settings.privacy.dmFromAll')}
          subtitle={t('settings.privacy.dmFromAllSub')}
          value={s.dm_from_all}
          onValueChange={(v) => save.mutate({ dm_from_all: v })}
        />
      </Section>

      {CHOICES.map((c) => (
        <Section key={c.key} title={t(c.title)}>
          {c.options.map((o) => (
            <Row
              key={o.v}
              title={t(o.label)}
              selected={s[c.key] === o.v}
              onPress={() => save.mutate({ [c.key]: o.v })}
              right={s[c.key] === o.v ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
            />
          ))}
        </Section>
      ))}

      <Section title={t('settings.privacy.myData')}>
        <Row icon="time-outline" title={t('settings.security.loginHistory')} onPress={() => router.push('/settings/login-history')} chevron />
        <Row icon="stats-chart-outline" title={t('settings.stats.title')} onPress={() => router.push('/settings/stats')} chevron />
        <Row
          icon="download-outline"
          title={t(exporting ? 'settings.privacy.exporting' : 'settings.privacy.export')}
          subtitle={t('settings.privacy.exportSub')}
          onPress={exporting ? undefined : () => void exportData()}
        />
      </Section>
    </ScrollView>
  )
}
