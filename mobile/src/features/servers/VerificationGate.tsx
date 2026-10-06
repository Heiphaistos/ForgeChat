import { Ionicons } from '@expo/vector-icons'
import { useState, type ReactNode } from 'react'
import { ScrollView, View } from 'react-native'
import { Button, SwitchRow, T } from '@/components/ui'
import { MessageText } from '@/components/MessageText'
import { needsVerification } from '@/features/account/rules'
import { errorMessage, http, path } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { colors, spacing } from '@/theme'
import { useServerDetail } from './menus'

/**
 * Barrière de vérification (même règle que le web, ChannelPage.tsx) : si le serveur l'exige et
 * que je ne l'ai pas encore acceptée, afficher ses règles à la place du contenu.
 */
export function VerificationGate({ serverId, children }: { serverId: string; children: ReactNode }) {
  const detail = useServerDetail(serverId)
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!needsVerification(detail.data)) return children

  const server = detail.data!.server as { name: string; verification_rules?: string | null }
  const verify = async () => {
    setBusy(true)
    setError(null)
    try {
      await http.post(path`/servers/${serverId}/verify`)
      await queryClient.invalidateQueries({ queryKey: qk.server(serverId) })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}>
      <View style={{ alignItems: 'center', gap: spacing.sm }}>
        <Ionicons name="shield-checkmark-outline" size={48} color={colors.primary} />
        <T variant="subtitle" style={{ textAlign: 'center' }}>
          Vérification requise
        </T>
        <T variant="muted" style={{ textAlign: 'center' }}>
          {server.name} demande d’accepter ses règles avant de participer.
        </T>
      </View>
      {server.verification_rules ? (
        <View style={{ backgroundColor: colors.bgAlt, borderRadius: 12, padding: spacing.lg }}>
          <MessageText content={server.verification_rules} />
        </View>
      ) : null}
      <View style={{ backgroundColor: colors.bgAlt, borderRadius: 12, overflow: 'hidden' }}>
        <SwitchRow title="J’ai lu et j’accepte les règles" value={accepted} onValueChange={setAccepted} />
      </View>
      {error ? <T variant="error">{error}</T> : null}
      <Button title="Accéder au serveur" onPress={() => void verify()} loading={busy} disabled={!accepted} />
    </ScrollView>
  )
}
