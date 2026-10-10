// En-tête d'un MP ou d'un groupe : cadenas « chiffré de bout en bout », codes de
// sécurité des membres et alerte « la clé de X a changé ».
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { Sheet } from '@/components/Sheet'
import { IconButton, T } from '@/components/ui'
import { useT } from '@/i18n'
import { getMyId } from '@/stores/auth'
import { colors, spacing } from '@/theme'
import { getMembers, type ConvKind } from './conversations'
import { trustedMembers } from './keyPins'
import { SafetyCode } from './E2ESettings'

/** Membres et clés publiques (le chiffrement est obligatoire : toujours chiffré). */
function useConvMembers(kind: ConvKind, id: string) {
  const { data } = useQuery({ queryKey: ['e2e_members', kind, id], queryFn: () => getMembers(kind, id), staleTime: 60_000 })
  return data ?? []
}

/** Cadenas toujours fermé ; membres sans clé signalés : ils liront après l'avoir créée. */
export function E2EBadge({ kind, id }: { kind: ConvKind; id: string }) {
  const t = useT()
  const members = useConvMembers(kind, id)
  const [open, setOpen] = useState(false)
  const me = getMyId()
  const others = members.filter((m) => m.user_id !== me)
  const missing = others.filter((m) => !m.public).map((m) => m.username).join(', ')

  // Empreintes recalculées et comparées aux épinglées dès l'ouverture : une clé changée ouvre
  // la boîte de dialogue bloquante (KeyChangeDialog) avant tout envoi ; première vue = épinglée.
  useEffect(() => { if (members.length) void trustedMembers(members) }, [members])

  return (
    <>
      <IconButton
        icon="lock-closed"
        color={colors.success}
        label={missing ? t('e2e.conv.notYetShort') : t('e2e.conv.encrypted')}
        onPress={() => setOpen(true)}
      />
      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title={t('e2e.conv.title')}
        actions={[]}
        header={
          <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ gap: spacing.md, padding: spacing.md }}>
            <T variant="muted">{t('e2e.conv.desc')}</T>
            {missing ? <T style={{ color: colors.warning }}>{t('e2e.conv.notYet', { names: missing })}</T> : null}
            {others.filter((m) => m.public).map((m) => (
              <View key={m.user_id}>
                <T>{m.username}</T>
                <SafetyCode userId={m.user_id} />
              </View>
            ))}
          </ScrollView>
        }
      />
    </>
  )
}
