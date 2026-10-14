import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, View } from 'react-native'
import { accountsApi, accountsKey } from '@/api/accounts'
import { Button, ErrorState, IconButton, Loading, Row, Section, SwitchRow, T, TextField } from '@/components/ui'
import { PLATFORMS, addAccountBody } from '@/features/account/connectedAccounts'
import { platformIcon } from '@/features/servers/discordFeatures'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { openExternalUrl } from '@/lib/links'
import { colors, spacing } from '@/theme'

/** Comptes liés (GitHub, Steam…) : ajout, visibilité sur le profil public, retrait, comme ConnectedAccountsSection du web. */
export default function ConnectedAccountsScreen() {
  const t = useT()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: accountsKey, queryFn: accountsApi.list })
  const [adding, setAdding] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [url, setUrl] = useState('')
  const refresh = () => qc.invalidateQueries({ queryKey: accountsKey })
  const fail = (e: unknown) => Alert.alert(t('acct.failed'), errorMessage(e))
  const add = useMutation({
    mutationFn: (b: NonNullable<ReturnType<typeof addAccountBody>>) => accountsApi.add(b),
    onSuccess: () => {
      setAdding(null)
      setUsername('')
      setUrl('')
      void refresh()
    },
    onError: fail,
  })
  const remove = useMutation({ mutationFn: accountsApi.remove, onSuccess: refresh, onError: fail })
  const visible = useMutation({ mutationFn: (v: { platform: string; visible: boolean }) => accountsApi.setVisible(v.platform, v.visible), onSuccess: refresh, onError: fail })

  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />

  const meta = PLATFORMS.find((p) => p.id === adding)
  const body = adding ? addAccountBody(adding, username, url) : null
  const confirmRemove = (platform: string, label: string) =>
    Alert.alert(t('acct.removeTitle', { name: label }), t('acct.removeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('acct.remove'), style: 'destructive', onPress: () => remove.mutate(platform) },
    ])

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: t('acct.title') }} />
      <T variant="muted" style={{ marginBottom: spacing.lg }}>
        {t('acct.intro')}
      </T>
      {meta ? (
        <View style={{ gap: spacing.sm, marginBottom: spacing.xl }}>
          <T variant="label">{t('acct.connect', { name: meta.label })}</T>
          <TextField value={username} onChangeText={setUsername} placeholder={t('acct.username')} accessibilityLabel={t('acct.username')} autoCapitalize="none" autoCorrect={false} maxLength={100} />
          <TextField value={url} onChangeText={setUrl} placeholder={t('acct.urlPh')} accessibilityLabel={t('acct.url')} autoCapitalize="none" autoCorrect={false} keyboardType="url" maxLength={300} />
          <Button title={t('acct.save')} disabled={!body} loading={add.isPending} onPress={() => body && add.mutate(body)} />
          <Button title={t('common.cancel')} variant="secondary" onPress={() => setAdding(null)} />
        </View>
      ) : null}
      {PLATFORMS.map((p) => {
        const acc = (q.data ?? []).find((a) => a.platform === p.id)
        return (
          <Section key={p.id}>
            <Row
              icon={platformIcon(p.id)}
              title={p.label}
              subtitle={acc ? `${acc.username}${acc.verified ? ` · ${t('df.accounts.verified')}` : ''}` : t('acct.notConnected')}
              onPress={acc ? undefined : () => setAdding(p.id)}
              chevron={!acc}
              right={
                acc ? (
                  <View style={{ flexDirection: 'row' }}>
                    {acc.url ? <IconButton icon="open-outline" label={t('acct.open', { name: p.label })} onPress={() => void openExternalUrl(acc.url as string)} /> : null}
                    <IconButton icon="trash-outline" label={t('acct.removeTitle', { name: p.label })} color={colors.danger} onPress={() => confirmRemove(p.id, p.label)} />
                  </View>
                ) : undefined
              }
            />
            {acc ? <SwitchRow title={t('acct.visible')} value={acc.visible} disabled={visible.isPending} onValueChange={(v) => visible.mutate({ platform: p.id, visible: v })} /> : null}
          </Section>
        )
      })}
    </ScrollView>
  )
}
