import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView } from 'react-native'
import { serversApi } from '@/api/servers'
import { Button, ErrorState, Loading, PasswordField, T, TextField } from '@/components/ui'
import { deleteServerBody, deleteServerError, deleteServerFailure } from '@/features/servers/deleteServer'
import { useServerDetail } from '@/features/servers/menus'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk, queryClient } from '@/lib/queryClient'
import { useAuth } from '@/stores/auth'
import { useUi } from '@/stores/ui'
import { colors, spacing } from '@/theme'

/** Suppression définitive : nom recopié, mot de passe, et code 2FA si elle est activée (servers.rs::verify_reauth). */
export default function DeleteServerScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const detail = useServerDetail(ids.serverId ?? '', valid)
  const totpEnabled = useAuth((s) => !!s.user?.totp_enabled)
  const [typedName, setTypedName] = useState('')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [askTotp, setAskTotp] = useState(false)
  const [errors, setErrors] = useState<{ password?: string; totp?: string; form?: string }>({})
  const [loading, setLoading] = useState(false)
  if (!valid) return <ErrorState message="Serveur invalide." />
  if (detail.isLoading) return <Loading />
  if (!detail.data) return <ErrorState message={errorMessage(detail.error)} onRetry={() => void detail.refetch()} />
  const server = detail.data.server
  const needTotp = totpEnabled || askTotp

  const doDelete = async () => {
    setLoading(true)
    setErrors({})
    try {
      await serversApi.remove(server.id, deleteServerBody(password, totp))
      if (useUi.getState().selectedServerId === server.id) useUi.getState().selectServer(null)
      queryClient.removeQueries({ queryKey: qk.server(server.id) })
      await queryClient.invalidateQueries({ queryKey: qk.servers })
      router.dismissAll()
      Alert.alert('Serveur supprimé', `« ${server.name} » a été supprimé.`)
    } catch (e) {
      const f = deleteServerFailure(e)
      if (f.needTotp) setAskTotp(true)
      setErrors({ [f.field]: f.message })
    } finally {
      setLoading(false)
    }
  }

  const submit = () => {
    const invalid = deleteServerError(typedName, server.name, password, needTotp, totp)
    if (invalid) {
      setErrors({ form: invalid })
      return
    }
    Alert.alert(`Supprimer « ${server.name} » ?`, 'Salons, messages, rôles et invitations seront effacés pour tous les membres. Action irréversible.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer le serveur', style: 'destructive', onPress: () => void doDelete() },
    ])
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <T>
        La suppression de « {server.name} » est définitive : salons, messages, rôles et invitations disparaissent pour tous les
        membres.
      </T>
      <TextField label="Recopie le nom du serveur" value={typedName} onChangeText={setTypedName} placeholder={server.name} autoCorrect={false} autoCapitalize="none" />
      <PasswordField label="Mot de passe" value={password} onChangeText={setPassword} autoComplete="current-password" textContentType="password" error={errors.password} />
      {needTotp ? (
        <TextField
          label="Code de double authentification"
          value={totp}
          onChangeText={setTotp}
          placeholder="123456 ou code de secours"
          keyboardType="default"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={32}
          error={errors.totp}
        />
      ) : null}
      {errors.form ? <T style={{ color: colors.danger }}>{errors.form}</T> : null}
      <Button title="Supprimer le serveur" variant="danger" icon="trash-outline" onPress={submit} loading={loading} />
    </ScrollView>
  )
}
