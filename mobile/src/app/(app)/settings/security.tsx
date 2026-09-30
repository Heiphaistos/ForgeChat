import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import * as LocalAuthentication from 'expo-local-authentication'
import { useEffect, useState } from 'react'
import { Alert, ScrollView } from 'react-native'
import { Row, Section, SwitchRow } from '@/components/ui'
import { useAuth } from '@/stores/auth'
import { biometricAvailability } from '@/stores/lock'
import { useSettings, type LockDelay } from '@/stores/settings'
import { colors, spacing } from '@/theme'

const DELAYS: { v: LockDelay; label: string }[] = [
  { v: 0, label: 'Immédiatement' },
  { v: 30, label: 'Après 30 s' },
  { v: 60, label: 'Après 1 min' },
  { v: 300, label: 'Après 5 min' },
]

export default function SecuritySettings() {
  const s = useSettings()
  const user = useAuth((st) => st.user)
  const logout = useAuth((st) => st.logout)
  const [bioOk, setBioOk] = useState<boolean | null>(null)

  useEffect(() => {
    void biometricAvailability().then((a) => setBioOk(a.usable))
  }, [])

  const toggleLock = async (on: boolean) => {
    if (on) {
      if (!bioOk) {
        Alert.alert('Indisponible', 'Configure un code, Face ID ou une empreinte sur ton appareil pour activer le verrouillage.')
        return
      }
      // Confirmer que l'utilisateur peut effectivement se déverrouiller avant d'activer.
      const res = await LocalAuthentication.authenticateAsync({ promptMessage: 'Activer le verrouillage de ForgeChat' })
      if (!res.success) return
    }
    s.set({ appLock: on })
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }}>
      <Section title="Verrouillage de l'app" footer="Demande Face ID / empreinte / code de l'appareil à l'ouverture de ForgeChat.">
        <SwitchRow icon="finger-print" title="Verrouiller ForgeChat" value={s.appLock} onValueChange={(v) => void toggleLock(v)} disabled={bioOk === false && !s.appLock} />
        {s.appLock
          ? DELAYS.map((d) => (
              <Row key={d.v} title={d.label} onPress={() => s.set({ lockDelay: d.v })} right={s.lockDelay === d.v ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null} />
            ))
          : null}
      </Section>

      <Section title="Confidentialité">
        <SwitchRow
          icon="eye-off-outline"
          title="Masquer dans le sélecteur d'apps"
          subtitle="Floute l'aperçu (iOS). Sur Android, bloque aussi les captures d'écran."
          value={s.privacyScreen}
          onValueChange={(v) => s.set({ privacyScreen: v })}
        />
        <SwitchRow
          icon="link-outline"
          title="Confirmer les liens externes"
          subtitle="Affiche le vrai domaine avant d'ouvrir un lien (anti-hameçonnage)."
          value={s.confirmLinks}
          onValueChange={(v) => s.set({ confirmLinks: v })}
        />
      </Section>

      <Section title="Compte">
        <Row icon="key-outline" title="Changer le mot de passe" onPress={() => router.push('/settings/password')} chevron />
        <Row
          icon="shield-checkmark-outline"
          title="Authentification à deux facteurs"
          subtitle={user?.totp_enabled ? 'Activée' : 'Désactivée — à configurer depuis la version web'}
        />
        <Row icon="phone-portrait-outline" title="Appareils connectés" onPress={() => router.push('/settings/sessions')} chevron />
        <Row
          icon="warning-outline"
          title="Déconnecter tous les appareils"
          danger
          onPress={() =>
            Alert.alert('Déconnecter partout ?', 'Toutes tes sessions (web, desktop, mobile) seront fermées.', [
              { text: 'Annuler', style: 'cancel' },
              { text: 'Tout déconnecter', style: 'destructive', onPress: () => void logout('all') },
            ])
          }
        />
      </Section>
    </ScrollView>
  )
}
