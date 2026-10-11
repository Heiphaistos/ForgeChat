// Affichage et saisie (mêmes réglages que le web : Texte et affichage, Extras), propres à cet
// appareil et appliqués tout de suite. Tout est calculé ici : rien de nouveau ne part en clair.
import { Ionicons } from '@expo/vector-icons'
import { ScrollView } from 'react-native'
import { Row, Section, SwitchRow } from '@/components/ui'
import { useT } from '@/i18n'
import { useUxPrefs, type SpoilerMode } from '@/stores/uxPrefs'
import { colors, spacing } from '@/theme'

const SPOILERS: { id: SpoilerMode; label: 'ux.display.spoilers.click' | 'ux.display.spoilers.always' }[] = [
  { id: 'click', label: 'ux.display.spoilers.click' },
  { id: 'always', label: 'ux.display.spoilers.always' },
]

export default function DisplaySettingsScreen() {
  const t = useT()
  const p = useUxPrefs()
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }}>
      <Section title={t('ux.display.spoilers')}>
        {SPOILERS.map((s) => (
          <Row
            key={s.id}
            title={t(s.label)}
            selected={p.spoilers === s.id}
            onPress={() => p.set({ spoilers: s.id })}
            right={p.spoilers === s.id ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
          />
        ))}
      </Section>
      <Section title={t('ux.display.messages')}>
        <SwitchRow title={t('ux.display.showReactions')} value={p.showReactions} onValueChange={(v) => p.set({ showReactions: v })} />
        <SwitchRow title={t('ux.display.showAttachments')} subtitle={t('ux.display.showAttachmentsDesc')} value={p.showAttachments} onValueChange={(v) => p.set({ showAttachments: v })} />
      </Section>
      <Section title={t('ux.display.typing')} footer={t('ux.deviceOnly')}>
        <SwitchRow title={t('ux.display.emoticons')} subtitle={t('ux.display.emoticonsDesc')} value={p.convertEmoticons} onValueChange={(v) => p.set({ convertEmoticons: v })} />
        <SwitchRow title={t('ux.extras.cleanUrls')} subtitle={t('ux.extras.cleanUrlsDesc')} value={p.cleanUrls} onValueChange={(v) => p.set({ cleanUrls: v })} />
        <SwitchRow title={t('ux.extras.silentTyping')} subtitle={t('ux.extras.silentTypingDesc')} value={p.silentTyping} onValueChange={(v) => p.set({ silentTyping: v })} />
        <SwitchRow title={t('ux.extras.replyPing')} subtitle={t('ux.extras.replyPingDesc')} value={p.replyPing} onValueChange={(v) => p.set({ replyPing: v })} />
      </Section>
    </ScrollView>
  )
}
