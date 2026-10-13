import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ClanTag, TAG_ICON_GLYPHS } from '@/components/ClanTag'
import { useT, type Key } from '@/i18n'
import { NAME_FONTS, TAG_BADGES, TAG_ICONS, cleanTagStyle, type TagStyle } from '@/lib/nameStyle'
import { colors, radius, spacing } from '@/theme'
import { ColorPicker } from './ColorPicker'
import { Chip, kit } from './editorKit'
import { fontLabel } from './nameStyleLabels'

/**
 * Style de l'étiquette perso (name_style.tag) : couleur (facultative), seconde couleur, fond,
 * police et icône, avec aperçu. Même contrat que le web (client/src/components/settings/
 * TagStyleFields.tsx) : seuls des identifiants de liste blanche et des couleurs 0xRRGGBB sortent.
 */
export function TagStyleEditor({ name, value, onChange }: { name: string; value?: TagStyle | null; onChange: (v: TagStyle | undefined) => void }) {
  const t = useT()
  const v = value ?? {}
  // Style vide → undefined (aucune clé `tag` envoyée, comme le serveur le normalise).
  const patch = (p: Partial<TagStyle>) => onChange(cleanTagStyle({ ...v, ...p }) ?? undefined)
  const shown = name.trim()
  if (!shown) return <Text style={kit.hint}>{t('tagEdit.needTag')}</Text>

  return (
    <View style={{ gap: spacing.md }}>
      <Text style={kit.title}>{t('tagEdit.title')}</Text>
      <View style={styles.preview} accessible accessibilityLabel={`${t('tagEdit.preview')} : ${shown}`}>
        <Text style={kit.hint}>{t('tagEdit.preview')}</Text>
        <ClanTag name={shown} style={v} fallback="soft" />
      </View>

      <ColorPicker label={t('tagEdit.color')} value={v.color} onChange={(c) => patch({ color: c })} onClear={() => patch({ color: undefined })} clearLabel={t('tagEdit.noColor')} />
      <ColorPicker label={t('tagEdit.color2')} value={v.color2} onChange={(c) => patch({ color2: c })} onClear={() => patch({ color2: undefined })} clearLabel={t('tagEdit.noColor2')} />

      <Text style={kit.label}>{t('tagEdit.badge')}</Text>
      <View style={kit.wrap} accessibilityRole="radiogroup" accessibilityLabel={t('tagEdit.badge')}>
        {TAG_BADGES.map((b) => {
          const on = (v.badge ?? '') === b
          const label = t(`pedit.tag.badge.${b || 'default'}` as Key)
          return (
            <Pressable key={b || 'default'} onPress={() => patch({ badge: b })} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={label} style={[styles.pill, on && styles.pillOn]}>
              <ClanTag name={shown} style={{ ...v, badge: b }} fallback="soft" />
            </Pressable>
          )
        })}
      </View>

      <Text style={kit.label}>{t('tagEdit.icon')}</Text>
      <View style={kit.wrap} accessibilityRole="radiogroup" accessibilityLabel={t('tagEdit.icon')}>
        {TAG_ICONS.map((i) => {
          const on = (v.icon ?? '') === i
          return (
            <Pressable key={i || 'none'} onPress={() => patch({ icon: i })} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={t(`pedit.tag.icon.${i || 'none'}` as Key)} style={[styles.icon, on && styles.pillOn]}>
              <Text style={{ color: colors.text }}>{i ? TAG_ICON_GLYPHS[i] : '∅'}</Text>
            </Pressable>
          )
        })}
      </View>

      <Text style={kit.label}>{t('tagEdit.font')}</Text>
      <View style={kit.wrap}>{NAME_FONTS.map((f) => <Chip key={f || 'none'} label={t(fontLabel(f))} selected={(v.font ?? '') === f} onPress={() => patch({ font: f })} />)}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  preview: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  pill: { padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  pillOn: { borderColor: colors.primary, backgroundColor: colors.bgElevated },
  icon: { width: 40, height: 40, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
})
