import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, TextInput } from 'react-native'
import { serversApi } from '@/api/servers'
import { Button, ErrorState, Loading, PasswordField, Row, Section, T } from '@/components/ui'
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
  if (!valid) return <ErrorState message="Serveur invalide." />
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
      Alert.alert('Propriété transférée', `${chosen.username} est maintenant propriétaire du serveur.`)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  const submit = () => {
    if (!chosen) return setError('Choisis le nouveau propriétaire.')
    if (!password) return setError('Ton mot de passe est requis.')
    Alert.alert(`Donner le serveur à ${chosen.username} ?`, 'Tu ne pourras plus le supprimer ni le récupérer toi-même.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Transférer', style: 'destructive', onPress: () => void doTransfer() },
    ])
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <TextInput
        style={{ backgroundColor: colors.bgDeep, color: colors.text, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10 }}
        placeholder="Rechercher un membre"
        placeholderTextColor={colors.textFaint}
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Rechercher un membre"
      />
      <Section title="Nouveau propriétaire">
        {list.map((m) => (
          <Row key={m.user_id} icon="person-outline" title={m.nickname || m.username} subtitle={m.nickname ? m.username : null} selected={target === m.user_id} onPress={() => setTarget(m.user_id)} right={target === m.user_id ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null} />
        ))}
        {list.length ? null : <Row title="Aucun membre" />}
      </Section>
      <PasswordField label="Ton mot de passe" value={password} onChangeText={setPassword} autoComplete="current-password" textContentType="password" />
      {error ? <T variant="error">{error}</T> : null}
      <Button title="Transférer la propriété" variant="danger" icon="swap-horizontal-outline" onPress={submit} loading={loading} />
    </ScrollView>
  )
}
