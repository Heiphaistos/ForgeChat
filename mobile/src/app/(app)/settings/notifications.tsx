import { ScrollView } from 'react-native'
import { Row, Section, SwitchRow } from '@/components/ui'
import { PUSH_AVAILABLE } from '@/config/env'
import { useSettings } from '@/stores/settings'
import { colors, spacing } from '@/theme'

export default function NotificationSettings() {
  const s = useSettings()
  if (!PUSH_AVAILABLE) {
    return (
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }}>
        <Section
          title="Notifications push"
          footer="En attendant, les messages et les appels arrivent quand l'app est ouverte."
        >
          <Row icon="notifications-off-outline" title="Pas encore disponibles" subtitle="Prévues dans une prochaine version de ForgeChat." />
        </Section>
      </ScrollView>
    )
  }
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }}>
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
    </ScrollView>
  )
}
