import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { usersApi } from '@/api/users'
import { Avatar } from '@/components/Avatar'
import { Sheet } from '@/components/Sheet'
import { Row, Section } from '@/components/ui'
import { APP_ENV, APP_VERSION, API_HOST } from '@/config/env'
import { errorMessage } from '@/lib/http'
import { useAuth } from '@/stores/auth'
import { usePresence } from '@/stores/presence'
import { colors, font, spacing, statusColors } from '@/theme'

const STATUSES = [
  { key: 'online', label: 'En ligne' },
  { key: 'away', label: 'Absent' },
  { key: 'dnd', label: 'Ne pas déranger' },
  { key: 'invisible', label: 'Invisible' },
] as const

export default function YouScreen() {
  const user = useAuth((s) => s.user)
  const logout = useAuth((s) => s.logout)
  const setUser = useAuth((s) => s.setUser)
  const [statusOpen, setStatusOpen] = useState(false)
  const [logoutOpen, setLogoutOpen] = useState(false)
  if (!user) return null
  const status = STATUSES.find((s) => s.key === user.status) ?? STATUSES[0]

  const changeStatus = async (key: (typeof STATUSES)[number]['key']) => {
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
          icon="ellipse"
          title="Statut"
          subtitle={status.label}
          onPress={() => setStatusOpen(true)}
          chevron
          right={<View style={[styles.dot, { backgroundColor: statusColors[user.status] ?? colors.textFaint }]} />}
        />
        <Row icon="person-outline" title="Mon profil" onPress={() => router.push('/settings/profile')} chevron />
      </Section>

      <Section title="Paramètres">
        <Row icon="shield-checkmark-outline" title="Sécurité et confidentialité" onPress={() => router.push('/settings/security')} chevron />
        <Row icon="phone-portrait-outline" title="Appareils connectés" onPress={() => router.push('/settings/sessions')} chevron />
        <Row icon="notifications-outline" title="Notifications" onPress={() => router.push('/settings/notifications')} chevron />
      </Section>

      <Section>
        <Row icon="log-out-outline" title="Se déconnecter" danger onPress={() => setLogoutOpen(true)} />
      </Section>

      <Text style={styles.version}>
        ForgeChat mobile {APP_VERSION} ({APP_ENV}) · {API_HOST}
      </Text>

      <Sheet
        visible={statusOpen}
        onClose={() => setStatusOpen(false)}
        title="Définir le statut"
        actions={STATUSES.map((s) => ({ label: s.label, icon: s.key === 'invisible' ? 'eye-off-outline' : 'ellipse', onPress: () => void changeStatus(s.key) }))}
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
  dot: { width: 12, height: 12, borderRadius: 6 },
  version: { color: colors.textFaint, fontSize: font.xs, textAlign: 'center', marginTop: spacing.md },
})
