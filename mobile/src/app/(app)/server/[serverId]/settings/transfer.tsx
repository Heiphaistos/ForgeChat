import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, TextInput } from 'react-native'
import { serversApi } from '@/api/servers'
import { Button, ErrorState, Loading, PasswordField, Row, Section, T } from '@/components/ui'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk, queryClient } from '@/lib/queryClient'
import { useAuth } from '@/stores/auth'
import { colors, radius, spacing } from '@/theme'

/** Transférer la propriété à un autre membre (POST /servers/:id/transfer, mot de passe requis). */
export default function TransferScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const sid = ids.serverId ?? ''
  const meId = useAuth((s) => s.user?.id)
  const members = useQuery({ queryKey: qk.members(sid), queryFn: () => serversApi.members(sid), enabled: valid })
  const [search, setSearch] = useState('')
  const [target, setTarget] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const t = useT()
  if (!valid) return <ErrorState message={t('serverSettings.invalidServer')} />
  if (members.isLoading) return <Loading />
  if (members.error) return <ErrorState message={errorMessage(members.error)} onRetry={() => void members.refetch()} />

  const needle = search.trim().toLowerCase()
  const list = (members.data ?? [])
    .filter((m) => m.user_id !== meId)
    .filter((m) => !needle || m.username.toLowerCase().includes(needle) || m.nickname?.toLowerCase().includes(needle))
    .slice(0, 50)
  const chosen = members.data?.find((m) => m.user_id === target)

  const doTransfer = async () => {
    if (!chosen) return
    setLoading(true)
    setError(null)
    try {
      await serversApi.transfer(sid, chosen.user_id, password)
      await Promise.all([qk.servers, qk.server(sid), qk.members(sid)].map((queryKey) => queryClient.invalidateQueries({ queryKey })))
      router.dismissAll()
      Alert.alert(t('serverSettings.audit.OWNER_TRANSFER'), t('serverSettings.transfer.doneBody', { name: chosen.username }))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  const submit = () => {
    if (!chosen) return setError(t('serverSettings.transfer.chooseOwner'))
    if (!password) return setError(t('serverSettings.transfer.passwordRequired'))
    Alert.alert(t('serverSettings.transfer.confirmTitle', { name: chosen.username }), t('serverSettings.transfer.confirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('serverSettings.transfer.transfer'), style: 'destructive', onPress: () => void doTransfer() },
    ])
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <TextInput
        style={{ backgroundColor: colors.bgDeep, color: colors.text, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10 }}
        placeholder={t('serverSettings.searchMember')}
        placeholderTextColor={colors.textFaint}
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={t('serverSettings.searchMember')}
      />
      <Section title={t('serverSettings.transfer.newOwner')}>
        {list.map((m) => (
          <Row key={m.user_id} icon="person-outline" title={m.nickname || m.username} subtitle={m.nickname ? m.username : null} selected={target === m.user_id} onPress={() => setTarget(m.user_id)} right={target === m.user_id ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null} />
        ))}
        {list.length ? null : <Row title={t('serverSettings.noMembers')} />}
      </Section>
      <PasswordField label={t('serverSettings.transfer.password')} value={password} onChangeText={setPassword} autoComplete="current-password" textContentType="password" />
      {error ? <T variant="error">{error}</T> : null}
      <Button title={t('screen.transfer')} variant="danger" icon="swap-horizontal-outline" onPress={submit} loading={loading} />
    </ScrollView>
  )
}
