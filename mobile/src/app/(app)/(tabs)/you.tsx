import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { usersApi } from '@/api/users'
import { Avatar, StatusDot } from '@/components/Avatar'
import { Sheet } from '@/components/Sheet'
import { Row, Section } from '@/components/ui'
import { APP_ENV, APP_VERSION, apiHost } from '@/config/env'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { normalizeStatus, SELECTABLE_STATUSES, statusLabel, toServerStatus } from '@/lib/status'
import { useAuth } from '@/stores/auth'
import { usePresence } from '@/stores/presence'
import { colors, font, spacing } from '@/theme'
import { useAppearance } from '@/theme/prefs'
import { AccountSwitcher } from '@/features/account/AccountSwitcher'
import { useSiteAdmin } from '@/features/admin/useSiteAdmin'


// Panneau « Infos dev » : retiré du bundle du client-apk. EXPO_PUBLIC_APP_ENV est inliné à la
// compilation : en production la condition est constante et le require disparaît (vérifié sur le
// bundle par __tests__/production-profile.test.ts et l'audit APK).
const DevInfoRow: (() => React.JSX.Element) | null =
  process.env.EXPO_PUBLIC_APP_ENV === 'production'
    ? null
    : // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('@/features/devtools/DevInfo') as typeof import('@/features/devtools/DevInfo')).DevInfoRow

export default function YouScreen() {
  const t = useT()
  const user = useAuth((s) => s.user)
  const logout = useAuth((s) => s.logout)
  const setUser = useAuth((s) => s.setUser)
  const streamer = useAppearance((s) => s.streamerMode)
  const [statusOpen, setStatusOpen] = useState(false)
  const [logoutOpen, setLogoutOpen] = useState(false)
  const { admin: isSiteAdmin } = useSiteAdmin()
  if (!user) return null
  // « idle » (écrit par le web) et « away » (écrit par le mobile) = Absent.
  const status = normalizeStatus(user.status)

  const changeStatus = async (key: 'online' | 'away' | 'dnd' | 'invisible') => {
    const prev = user.status
    setUser({ status: key })
    usePresence.getState().set(user.id, key)
    try {
      await usersApi.setStatus(toServerStatus(key))
    } catch (e) {
      setUser({ status: prev })
      Alert.alert(t('you.statusFailed'), errorMessage(e))
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }}>
      <View style={styles.header}>
        <Avatar uri={user.avatar} name={user.username} size={80} userId={user.id} status={user.status} showStatus />
        <Text style={styles.name}>{user.username}</Text>
        <Text style={styles.tag}>
          {user.username}#{streamer ? '••••' : user.discriminator}
          {user.pronouns ? ` · ${user.pronouns}` : ''}
        </Text>
        {user.custom_status ? <Text style={styles.custom}>{user.custom_status}</Text> : null}
      </View>

      <Section>
        <Row
          icon="radio-button-on-outline"
          title={t('you.status')}
          subtitle={statusLabel(status)}
          onPress={() => setStatusOpen(true)}
          chevron
          right={<StatusDot status={status} size={14} inline />}
        />
        <Row icon="person-outline" title={t('you.profile')} onPress={() => router.push('/settings/profile')} chevron />
        <Row icon="musical-notes-outline" title={t('soc.settings.title')} subtitle={t('soc.settings.sub')} onPress={() => router.push('/settings/social')} chevron />
        <Row icon="bookmark-outline" title={t('you.saved')} onPress={() => router.push('/saved')} chevron />
        <Row icon="calendar-outline" title={t('messaging.sched.title')} onPress={() => router.push('/scheduled')} chevron />
      </Section>

      <AccountSwitcher />

      {isSiteAdmin ? (
        <Section>
          <Row icon="ribbon-outline" title="Administration" subtitle="Comptes, invitations, bannissements" onPress={() => router.push('/admin')} chevron />
        </Section>
      ) : null}

      <Section title={t('you.settings')}>
        <Row icon="shield-checkmark-outline" title={t('you.security')} onPress={() => router.push('/settings/security')} chevron />
        <Row icon="lock-closed-outline" title={t('you.privacy')} onPress={() => router.push('/settings/privacy')} chevron />
        <Row icon="phone-portrait-outline" title={t('you.sessions')} onPress={() => router.push('/settings/sessions')} chevron />
        <Row icon="notifications-outline" title={t('you.notifications')} onPress={() => router.push('/settings/notifications')} chevron />
        <Row icon="options-outline" title={t('ux.nc.open')} subtitle={t('ux.nc.openDesc')} onPress={() => router.push('/notifications')} chevron />
        <Row icon="mic-outline" title={t('voiceLot.title')} onPress={() => router.push('/settings/voice')} chevron />
        <Row icon="sparkles-outline" title={t('ai.title')} onPress={() => router.push('/settings/ai')} chevron />
        <Row icon="color-palette-outline" title={t('you.appearance')} onPress={() => router.push('/settings/appearance')} chevron />
        <Row icon="text-outline" title={t('ux.display.title')} subtitle={t('ux.display.subtitle')} onPress={() => router.push('/settings/display')} chevron />
      </Section>

      {DevInfoRow ? (
        <Section title={t('you.dev')}>
          <DevInfoRow />
        </Section>
      ) : null}

      <Section>
        <Row icon="log-out-outline" title={t('you.logout')} danger onPress={() => setLogoutOpen(true)} />
      </Section>

      <Text style={styles.version}>
        ForgeChat {APP_VERSION}
        {APP_ENV === 'production' ? '' : ` (${APP_ENV}) · ${apiHost() || t('you.noServer')}`}
        {'\n'}
        {t('you.credits')}
      </Text>

      <Sheet
        visible={statusOpen}
        onClose={() => setStatusOpen(false)}
        title={t('you.setStatus')}
        actions={SELECTABLE_STATUSES.map((s) => ({
          label: statusLabel(s),
          icon: 'ellipse',
          leading: <StatusDot status={s} size={16} inline />,
          selected: s === status,
          onPress: () => void changeStatus(s as 'online' | 'away' | 'dnd' | 'invisible'),
        }))}
      />
      <Sheet
        visible={logoutOpen}
        onClose={() => setLogoutOpen(false)}
        title={t('you.logout')}
        actions={[
          { label: t('you.logoutThis'), icon: 'phone-portrait-outline', onPress: () => void logout('current') },
          { label: t('you.logoutAll'), icon: 'warning-outline', danger: true, onPress: () => void logout('all') },
        ]}
      />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', marginBottom: spacing.xl, gap: 4 },
  name: { color: colors.text, fontSize: font.xl, fontWeight: '800', marginTop: spacing.md },
  tag: { color: colors.textMuted, fontSize: font.sm },
  custom: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xs },
  version: { color: colors.textFaint, fontSize: font.xs, textAlign: 'center', marginTop: spacing.md },
})
