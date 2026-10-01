import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { usersApi } from '@/api/users'
import { Avatar, StatusDot } from '@/components/Avatar'
import { Sheet } from '@/components/Sheet'
import { Row, Section } from '@/components/ui'
import { APP_ENV, APP_VERSION, API_HOST } from '@/config/env'
import { errorMessage } from '@/lib/http'
import { normalizeStatus, SELECTABLE_STATUSES, statusLabel } from '@/lib/status'
import { useAuth } from '@/stores/auth'
import { usePresence } from '@/stores/presence'
import { colors, font, spacing } from '@/theme'


// Panneau « Infos dev » : retiré du bundle du client-apk. EXPO_PUBLIC_APP_ENV est inliné à la
// compilation : en production la condition est constante et le require disparaît (vérifié sur le
// bundle par __tests__/production-profile.test.ts et l'audit APK).
const DevInfoRow: (() => React.JSX.Element) | null =
  process.env.EXPO_PUBLIC_APP_ENV === 'production'
    ? null
    : // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('@/features/devtools/DevInfo') as typeof import('@/features/devtools/DevInfo')).DevInfoRow

export default function YouScreen() {
  const user = useAuth((s) => s.user)
  const logout = useAuth((s) => s.logout)
  const setUser = useAuth((s) => s.setUser)
  const [statusOpen, setStatusOpen] = useState(false)
  const [logoutOpen, setLogoutOpen] = useState(false)
  if (!user) return null
  // « idle » (écrit par le web) et « away » (écrit par le mobile) = Absent.
  const status = normalizeStatus(user.status)

  const changeStatus = async (key: 'online' | 'away' | 'dnd' | 'invisible') => {
    const prev = user.status
    setUser({ status: key })
    usePresence.getState().set(user.id, key)
    try {
      await usersApi.setStatus(key)
    } catch (e) {
      setUser({ status: prev })
      Alert.alert('Statut non modifié', errorMessage(e))
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }}>
      <View style={styles.header}>
        <Avatar uri={user.avatar} name={user.username} size={80} userId={user.id} status={user.status} showStatus />
        <Text style={styles.name}>{user.username}</Text>
        <Text style={styles.tag}>
          {user.username}#{user.discriminator}
          {user.pronouns ? ` · ${user.pronouns}` : ''}
        </Text>
        {user.custom_status ? <Text style={styles.custom}>{user.custom_status}</Text> : null}
      </View>

      <Section>
        <Row
          icon="radio-button-on-outline"
          title="Statut"
          subtitle={statusLabel(status)}
          onPress={() => setStatusOpen(true)}
          chevron
          right={<StatusDot status={status} size={14} inline />}
        />
        <Row icon="person-outline" title="Mon profil" onPress={() => router.push('/settings/profile')} chevron />
      </Section>

      <Section title="Paramètres">
        <Row icon="shield-checkmark-outline" title="Sécurité et confidentialité" onPress={() => router.push('/settings/security')} chevron />
        <Row icon="phone-portrait-outline" title="Appareils connectés" onPress={() => router.push('/settings/sessions')} chevron />
        <Row icon="notifications-outline" title="Notifications" onPress={() => router.push('/settings/notifications')} chevron />
      </Section>

      {DevInfoRow ? (
        <Section title="Développement">
          <DevInfoRow />
        </Section>
      ) : null}

      <Section>
        <Row icon="log-out-outline" title="Se déconnecter" danger onPress={() => setLogoutOpen(true)} />
      </Section>

      <Text style={styles.version}>
        ForgeChat {APP_VERSION}
        {APP_ENV === 'production' ? '' : ` (${APP_ENV}) · ${API_HOST}`}
      </Text>

      <Sheet
        visible={statusOpen}
        onClose={() => setStatusOpen(false)}
        title="Définir le statut"
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
        title="Se déconnecter"
        actions={[
          { label: 'De cet appareil', icon: 'phone-portrait-outline', onPress: () => void logout('current') },
          { label: 'De tous les appareils', icon: 'warning-outline', danger: true, onPress: () => void logout('all') },
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
