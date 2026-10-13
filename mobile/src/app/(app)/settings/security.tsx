import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import * as LocalAuthentication from 'expo-local-authentication'
import { useEffect, useState } from 'react'
import { Alert, Platform, ScrollView } from 'react-native'
import { Row, Section, SwitchRow } from '@/components/ui'
import { UPDATES_MANIFEST_URL } from '@/config/env'
import { t as tr, useT, type Key } from '@/i18n'
import { E2EKeySection } from '@/e2e/E2ESettings'
import { checkForUpdateNow } from '@/features/updates/useUpdateCheck'
import { useAuth } from '@/stores/auth'
import { biometricAvailability } from '@/stores/lock'
import { useSettings, type LockDelay } from '@/stores/settings'
import { colors, spacing } from '@/theme'

const DELAYS: { v: LockDelay; label: Key }[] = [
  { v: 0, label: 'settings.security.lockNow' },
  { v: 30, label: 'settings.security.lock30s' },
  { v: 60, label: 'settings.security.lock1m' },
  { v: 300, label: 'settings.security.lock5m' },
]

export default function SecuritySettings() {
  const s = useSettings()
  const t = useT()
  const user = useAuth((st) => st.user)
  const logout = useAuth((st) => st.logout)
  const [bioOk, setBioOk] = useState<boolean | null>(null)

  useEffect(() => {
    // Garde de montage : pas de mise à jour d'état après avoir quitté l'écran.
    let alive = true
    biometricAvailability()
      .then((a) => alive && setBioOk(a.usable))
      .catch(() => alive && setBioOk(false))
    return () => {
      alive = false
    }
  }, [])

  const toggleLock = async (on: boolean) => {
    if (on) {
      if (!bioOk) {
        Alert.alert(tr('settings.security.unavailable'), tr('settings.security.unavailableBody'))
        return
      }
      // Confirmer que l'utilisateur peut effectivement se déverrouiller avant d'activer.
      const res = await LocalAuthentication.authenticateAsync({ promptMessage: tr('settings.security.enablePrompt') })
      if (!res.success) return
    } else if ((await biometricAvailability()).usable) {
      // Désactiver affaiblit la protection : même preuve que pour déverrouiller. Si l'appareil
      // n'a plus aucun moyen d'authentification, on laisse désactiver (sinon blocage).
      const res = await LocalAuthentication.authenticateAsync({ promptMessage: tr('settings.security.disablePrompt') })
      if (!res.success) return
    }
    s.set({ appLock: on })
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
      <E2EKeySection />
      <Section title={t('settings.security.lockSection')} footer={t('settings.security.lockFooter')}>
        <SwitchRow icon="finger-print" title={t('settings.security.lockApp')} value={s.appLock} onValueChange={(v) => void toggleLock(v)} disabled={bioOk === false && !s.appLock} />
        {s.appLock
          ? DELAYS.map((d) => (
              <Row key={d.v} title={t(d.label)} selected={s.lockDelay === d.v} onPress={() => s.set({ lockDelay: d.v })} right={s.lockDelay === d.v ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null} />
            ))
          : null}
      </Section>

      <Section title={t('settings.security.privacy')}>
        <SwitchRow
          icon="eye-off-outline"
          title={t('settings.security.hideSwitcher')}
          subtitle={t('settings.security.hideSwitcherSub')}
          value={s.privacyScreen}
          onValueChange={(v) => s.set({ privacyScreen: v })}
        />
        {Platform.OS === 'android' ? (
          <SwitchRow
            icon="apps-outline"
            title={t('widget.showContent')}
            subtitle={t('widget.showContentSub')}
            value={s.widgetShowContent}
            onValueChange={(v) => s.set({ widgetShowContent: v })}
          />
        ) : null}
        <SwitchRow
          icon="link-outline"
          title={t('settings.security.confirmLinks')}
          subtitle={t('settings.security.confirmLinksSub')}
          value={s.confirmLinks}
          onValueChange={(v) => s.set({ confirmLinks: v })}
        />
      </Section>

      {UPDATES_MANIFEST_URL ? (
        <Section
          title={t('settings.security.updates')}
          footer={t('settings.security.updatesFooter')}
        >
          <SwitchRow
            icon="cloud-download-outline"
            title={t('settings.security.offerUpdates')}
            value={s.updateCheck}
            onValueChange={(v) => s.set({ updateCheck: v })}
          />
          <Row icon="refresh-outline" title={t('settings.security.checkUpdate')} onPress={() => void checkForUpdateNow()} chevron />
        </Section>
      ) : null}

      <Section title={t('settings.security.account')}>
        <Row icon="key-outline" title={t('settings.security.changePassword')} onPress={() => router.push('/settings/password')} chevron />
        <Row
          icon="shield-checkmark-outline"
          title={t('settings.security.twoFactor')}
          subtitle={t(user?.totp_enabled ? 'settings.security.enabled' : 'settings.security.disabled')}
          onPress={() => router.push('/settings/two-factor')}
          chevron
        />
        <Row icon="phone-portrait-outline" title={t('settings.security.devices')} onPress={() => router.push('/settings/sessions')} chevron />
        <Row icon="time-outline" title={t('settings.security.loginHistory')} onPress={() => router.push('/settings/login-history')} chevron />
        <Row
          icon="warning-outline"
          title={t('settings.security.logoutAll')}
          danger
          onPress={() =>
            Alert.alert(t('settings.security.logoutAllTitle'), t('settings.security.logoutAllBody'), [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('settings.security.logoutAllConfirm'), style: 'destructive', onPress: () => void logout('all') },
            ])
          }
        />
        <Row icon="trash-outline" title={t('settings.security.deleteAccount')} danger onPress={() => router.push('/settings/delete-account')} chevron />
      </Section>
    </ScrollView>
  )
}
