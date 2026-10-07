import * as Clipboard from 'expo-clipboard'
import { useState } from 'react'
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import { serversApi } from '@/api/servers'
import { Button, ErrorState, T } from '@/components/ui'
import { apiOrigin } from '@/config/env'
import { useT, type Key } from '@/i18n'
import { ApiError, errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { colors, font, radius, spacing } from '@/theme'
import { useAppearance } from '@/theme/prefs'

const EXPIRY: { label: Key; hours: number }[] = [
  { label: 'server.invite.hour', hours: 1 },
  { label: 'server.invite.day', hours: 24 },
  { label: 'server.invite.week', hours: 168 },
]

/**
 * Chaque lien est une invitation valide : on n'en crée que sur appui de « Générer »,
 * et on révoque le précédent de cet écran s'il n'a pas servi.
 */
export default function InviteScreen() {
  const t = useT()
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const streamer = useAppearance((st) => st.streamerMode)
  const [hours, setHours] = useState(24)
  const [current, setCurrent] = useState<{ code: string; label: Key } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!valid) return <ErrorState message={t('server.invalid')} />

  const revokeIfUnused = async (code: string) => {
    const list = await serversApi.invites(ids.serverId)
    const prev = list.find((i) => i.code === code)
    if (!prev || prev.uses > 0) return // déjà expiré/supprimé, ou utilisé : on le laisse
    try {
      await serversApi.deleteInvite(ids.serverId, code)
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e
    }
  }

  const generate = async () => {
    setLoading(true)
    setError(null)
    try {
      // Révocation d'abord : si elle échoue, on ne crée pas une invitation de plus.
      if (current) await revokeIfUnused(current.code)
      setCurrent(null)
      const inv = await serversApi.createInvite(ids.serverId, undefined, hours)
      setCurrent({ code: inv.code, label: EXPIRY.find((e) => e.hours === hours)?.label ?? 'server.invite.day' })
    } catch (e) {
      setError(errorMessage(e, t('server.invite.failed')))
    } finally {
      setLoading(false)
    }
  }

  const link = current ? `${apiOrigin()}/invite/${current.code}` : null

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}>
      <T variant="muted">{t('server.invite.intro')}</T>
      <View style={{ flexDirection: 'row', gap: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel={t('server.invite.duration')}>
        {EXPIRY.map((e) => (
          <Button
            key={e.hours}
            title={t(e.label)}
            variant={hours === e.hours ? 'primary' : 'secondary'}
            onPress={() => setHours(e.hours)}
            accessibilityRole="radio"
            accessibilityState={{ selected: hours === e.hours }}
            style={{ flex: 1 }}
          />
        ))}
      </View>
      <Button title={current ? t('server.invite.generateNew') : t('server.invite.generate')} onPress={generate} loading={loading} />
      {current ? <T variant="muted">{t('server.invite.replaceHint')}</T> : null}
      {error ? <T variant="muted">{error}</T> : null}
      {link && current ? (
        <View style={styles.link}>
          <Text style={styles.linkText} selectable>
            {streamer ? `${apiOrigin()}/invite/••••••` : link}
          </Text>
          <T variant="muted">{t('server.invite.validFor', { duration: t(current.label) })}</T>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button title={t('server.invite.copy')} variant="secondary" icon="copy-outline" style={{ flex: 1 }} onPress={() => void Clipboard.setStringAsync(link)} />
            <Button title={t('server.invite.share')} icon="share-outline" style={{ flex: 1 }} onPress={() => void Share.share({ message: link })} />
          </View>
        </View>
      ) : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  link: { backgroundColor: colors.bgAlt, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  linkText: { color: colors.link, fontSize: font.md },
})
