// En-tête d'un MP ou d'un groupe : cadenas « chiffré de bout en bout », codes de
// sécurité des membres et alerte « la clé de X a changé ».
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Alert, ScrollView, View } from 'react-native'
import { Sheet } from '@/components/Sheet'
import { IconButton, T } from '@/components/ui'
import { useT } from '@/i18n'
import { secureStateStorage } from '@/lib/secureStorage'
import { getMyId } from '@/stores/auth'
import { colors, spacing } from '@/theme'
import { getMembers, keyChanges, type ConvKind, type ConvMember } from './conversations'
import { SafetyCode } from './E2ESettings'

/** Vrai quand tous les membres ont une clé : la conversation est chiffrée. */
export function useConvEncrypted(kind: ConvKind, id: string) {
  const { data } = useQuery({ queryKey: ['e2e_members', kind, id], queryFn: () => getMembers(kind, id), staleTime: 60_000 })
  return { members: data ?? [], encrypted: !!data?.length && data.every((m) => !!m.public) }
}

// Empreintes déjà vues, une entrée par personne (SecureStore limite la taille des valeurs).
const seenKey = (me: string, user: string) => `fc_e2e_fp_${me}_${user}`
async function readSeen(me: string, members: ConvMember[]) {
  const seen: Record<string, string> = {}
  for (const m of members) {
    const v = await secureStateStorage.getItem(seenKey(me, m.user_id))
    if (typeof v === 'string') seen[m.user_id] = v
  }
  return seen
}
async function acceptKeys(me: string, members: ConvMember[]) {
  for (const m of members) if (m.fingerprint) await secureStateStorage.setItem(seenKey(me, m.user_id), m.fingerprint)
}

export function E2EBadge({ kind, id }: { kind: ConvKind; id: string }) {
  const t = useT()
  const { members, encrypted } = useConvEncrypted(kind, id)
  const [open, setOpen] = useState(false)
  const me = getMyId()
  const others = members.filter((m) => m.user_id !== me)
  const missing = others.filter((m) => !m.public).map((m) => m.username).join(', ')

  useEffect(() => {
    if (!me || !members.length) return
    let alive = true
    void readSeen(me, members).then((seen) => {
      if (!alive) return
      const changed = keyChanges(members, seen, me)
      if (!changed.length) return void acceptKeys(me, members)
      Alert.alert(t('e2e.conv.title'), t('e2e.conv.keyChanged', { names: changed.map((m) => m.username).join(', ') }), [
        { text: t('e2e.conv.keyChangedOk'), onPress: () => void acceptKeys(me, members) },
      ])
    })
    return () => { alive = false }
  }, [me, members, t])

  return (
    <>
      <IconButton
        icon={encrypted ? 'lock-closed' : 'lock-open-outline'}
        color={encrypted ? colors.success : colors.textSecondary}
        label={encrypted ? t('e2e.conv.encrypted') : t('e2e.conv.notYetShort')}
        onPress={() => setOpen(true)}
      />
      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title={t('e2e.conv.title')}
        actions={[]}
        header={
          <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ gap: spacing.md, padding: spacing.md }}>
            <T variant="muted">{encrypted ? t('e2e.conv.desc') : t('e2e.conv.notYet', { names: missing })}</T>
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
