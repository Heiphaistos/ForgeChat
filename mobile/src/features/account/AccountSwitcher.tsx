import { useEffect, useState } from 'react'
import { Alert, View } from 'react-native'
import { Avatar } from '@/components/Avatar'
import { Button, Row, Section } from '@/components/ui'
import { useT } from '@/i18n'
import { forgetAccount, listAccounts, MAX_OTHER_ACCOUNTS, type SavedAccount } from '@/lib/accounts'
import { errorMessage } from '@/lib/http'
import { useAuth } from '@/stores/auth'
import { spacing } from '@/theme'

function useSavedAccounts() {
  const [list, setList] = useState<SavedAccount[]>([])
  useEffect(() => {
    void listAccounts().then(setList)
  }, [])
  return [list, setList] as const
}

const switchTo = async (id: string, failed: string) => {
  try {
    if (!(await useAuth.getState().switchAccount(id))) Alert.alert(failed)
  } catch (e) {
    Alert.alert(failed, errorMessage(e))
  }
}

/** Onglet « Vous » : autres comptes de l'appli, bascule rapide, ajout. */
export function AccountSwitcher() {
  const t = useT()
  const [list, setList] = useSavedAccounts()

  const forget = (a: SavedAccount) =>
    Alert.alert(t('accounts.forgetTitle', { name: a.username }), t('accounts.forgetBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('accounts.forgetConfirm'),
        style: 'destructive',
        onPress: () => void forgetAccount(a.id).then(() => setList((l) => l.filter((x) => x.id !== a.id))),
      },
    ])

  return (
    <Section title={t('accounts.title')} footer={t('accounts.footer')}>
      {list.map((a) => (
          <Row
            key={a.id}
            title={a.username}
            subtitle={t('accounts.tapToSwitch')}
            right={<Avatar uri={a.avatar} name={a.username} size={28} userId={a.id} />}
            onPress={() =>
              Alert.alert(t('accounts.switchTo', { name: a.username }), undefined, [
                { text: t('common.cancel'), style: 'cancel' },
                { text: t('accounts.forgetConfirm'), style: 'destructive', onPress: () => forget(a) },
                { text: t('accounts.switch'), onPress: () => void switchTo(a.id, t('accounts.error')) },
              ])
            }
          />
      ))}
      {list.length < MAX_OTHER_ACCOUNTS ? (
        <Row icon="person-add-outline" title={t('accounts.add')} onPress={() => void useAuth.getState().addAccount()} />
      ) : null}
    </Section>
  )
}

/** Écran de connexion : reprendre un compte resté connecté sur ce téléphone. */
export function SavedAccountsLogin() {
  const t = useT()
  const [list] = useSavedAccounts()
  if (list.length === 0) return null
  return (
    <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
      {list.map((a) => (
        <Button key={a.id} variant="ghost" title={t('accounts.resumeAs', { name: a.username })} onPress={() => void switchTo(a.id, t('accounts.error'))} />
      ))}
    </View>
  )
}
