import * as Clipboard from 'expo-clipboard'
import { useState } from 'react'
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import { serversApi } from '@/api/servers'
import { Button, ErrorState, T } from '@/components/ui'
import { API_ORIGIN } from '@/config/env'
import { ApiError, errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { colors, font, radius, spacing } from '@/theme'

const EXPIRY = [
  { label: '1 heure', hours: 1 },
  { label: '1 jour', hours: 24 },
  { label: '7 jours', hours: 168 },
]

/**
 * Chaque lien est une invitation valide : on n'en crée que sur appui de « Générer »,
 * et on révoque le précédent de cet écran s'il n'a pas servi.
 */
export default function InviteScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const [hours, setHours] = useState(24)
  const [current, setCurrent] = useState<{ code: string; label: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!valid) return <ErrorState message="Serveur invalide." />

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
      setCurrent({ code: inv.code, label: EXPIRY.find((e) => e.hours === hours)?.label ?? '' })
    } catch (e) {
      setError(errorMessage(e, 'Invitation impossible.'))
    } finally {
      setLoading(false)
    }
  }

  const link = current ? `${API_ORIGIN}/invite/${current.code}` : null

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}>
      <T variant="muted">Génère un lien d’invitation temporaire. Ne le partage qu’avec des personnes de confiance.</T>
      <View style={{ flexDirection: 'row', gap: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel="Durée de validité">
        {EXPIRY.map((e) => (
          <Button
            key={e.hours}
            title={e.label}
            variant={hours === e.hours ? 'primary' : 'secondary'}
            onPress={() => setHours(e.hours)}
            accessibilityRole="radio"
            accessibilityState={{ selected: hours === e.hours }}
            style={{ flex: 1 }}
          />
        ))}
      </View>
      <Button title={current ? 'Générer un nouveau lien' : 'Générer le lien'} onPress={generate} loading={loading} />
      {current ? <T variant="muted">Le nouveau lien remplacera celui-ci s’il n’a pas encore servi.</T> : null}
      {error ? <T variant="muted">{error}</T> : null}
      {link && current ? (
        <View style={styles.link}>
          <Text style={styles.linkText} selectable>
            {link}
          </Text>
          <T variant="muted">Valable {current.label}</T>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button title="Copier" variant="secondary" icon="copy-outline" style={{ flex: 1 }} onPress={() => void Clipboard.setStringAsync(link)} />
            <Button title="Partager" icon="share-outline" style={{ flex: 1 }} onPress={() => void Share.share({ message: link })} />
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
