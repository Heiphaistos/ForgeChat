import { ScrollView } from 'react-native'
import { Section, SwitchRow } from '@/components/ui'
import { IS_LAN } from '@/config/env'
import { useSettings } from '@/stores/settings'
import { colors, spacing } from '@/theme'

export default function NotificationSettings() {
  const s = useSettings()
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }}>
      <Section
        title="Notifications push"
        footer={
          IS_LAN
            ? 'Indisponibles dans la version de test local : les messages arrivent quand l’app est ouverte.'
            : "Envoyées quand l'app est fermée ou en arrière-plan : messages privés, mentions, demandes d'ami et appels."
        }
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
    </ScrollView>
  )
}
