import { StyleSheet, Text, View } from 'react-native'
import { Button, IconButton, TextField } from '@/components/ui'
import { PROFILE_LINKS_MAX, profileLinkError } from '@/features/account/rules'
import { useT } from '@/i18n'
import type { ProfileLink } from '@/types/models'
import { colors, font, radius, spacing } from '@/theme'

/** Liens du profil : 5 au plus, https:// uniquement (vérifié ici et par le serveur). */
export function ProfileLinksEditor({ value, onChange, showErrors }: { value: ProfileLink[]; onChange: (v: ProfileLink[]) => void; showErrors: boolean }) {
  const t = useT()
  const patch = (i: number, p: Partial<ProfileLink>) => onChange(value.map((l, j) => (j === i ? { ...l, ...p } : l)))
  return (
    <View style={{ gap: spacing.md }}>
      <Text style={styles.title}>{t('settings.links.title', { n: value.length, max: PROFILE_LINKS_MAX })}</Text>
      {value.map((l, i) => {
        const err = showErrors ? profileLinkError(l) : null
        return (
          <View key={i} style={styles.card}>
            <View style={{ flex: 1, gap: spacing.sm }}>
              <TextField label={t('settings.links.label')} value={l.label} onChangeText={(v) => patch(i, { label: v })} maxLength={32} />
              <TextField
                label={t('settings.links.url')}
                placeholder="https://"
                value={l.url}
                onChangeText={(v) => patch(i, { url: v })}
                maxLength={256}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                error={err ?? undefined}
              />
            </View>
            <IconButton icon="trash-outline" label={t('settings.links.remove')} onPress={() => onChange(value.filter((_, j) => j !== i))} />
          </View>
        )
      })}
      {value.length < PROFILE_LINKS_MAX ? (
        <Button title={t('settings.links.add')} variant="secondary" icon="add" onPress={() => onChange([...value, { label: '', url: 'https://' }])} />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: font.lg, fontWeight: '700' },
  card: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.bgElevated },
})
