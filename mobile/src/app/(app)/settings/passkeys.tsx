import { Ionicons } from '@expo/vector-icons'
import { Stack, router } from 'expo-router'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, ScrollView, View } from 'react-native'
import { passkeysApi, type Passkey } from '@/api/passkeys'
import { Button, Section, T, TextField, Row, Loading } from '@/components/ui'
import { t as tr, useT } from '@/i18n'
import { formatShort } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { PasskeyCancelled, passkeySupported } from '@/lib/passkey'
import { useAuth } from '@/stores/auth'
import { colors, spacing } from '@/theme'

/** Clés d'accès (WebAuthn) du compte : liste, ajout et retrait, chacun avec un code 2FA. */
export default function PasskeysScreen() {
  const t = useT()
  const qc = useQueryClient()
  const totpOn = useAuth((s) => !!s.user?.totp_enabled)
  const supported = passkeySupported()
  const keys = useQuery({ queryKey: ['passkeys'], queryFn: passkeysApi.list })
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  // Clé dont le retrait est en cours de confirmation (le code se saisit dans le même champ).
  const [removing, setRemoving] = useState<Passkey | null>(null)

  const add = useMutation({
    mutationFn: () => passkeysApi.add(name, code),
    onSuccess: () => {
      setName('')
      setCode('')
      void qc.invalidateQueries({ queryKey: ['passkeys'] })
      Alert.alert(tr('guard.passkey.added'))
    },
    // Annulation dans la feuille système : silencieux. Le défi serveur expire seul.
    onError: (e) => {
      if (!(e instanceof PasskeyCancelled)) Alert.alert(errorMessage(e))
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => passkeysApi.remove(id, code),
    onSuccess: () => {
      setRemoving(null)
      setCode('')
      void qc.invalidateQueries({ queryKey: ['passkeys'] })
    },
    onError: (e) => Alert.alert(errorMessage(e)),
  })

  const askRemove = (k: Passkey) =>
    Alert.alert(tr('guard.passkey.remove'), tr('guard.passkey.removeConfirm'), [
      { text: tr('common.cancel'), style: 'cancel' },
      { text: tr('guard.passkey.remove'), style: 'destructive', onPress: () => { setCode(''); setRemoving(k) } },
    ])

  const codeField = (
    <TextField
      label={t('guard.passkey.codePrompt')}
      value={code}
      onChangeText={setCode}
      keyboardType="number-pad"
      autoComplete="one-time-code"
      textContentType="oneTimeCode"
      maxLength={19}
      accessibilityLabel={t('guard.passkey.codePrompt')}
    />
  )
  const codeOk = code.trim().length >= 6

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: t('guard.passkey.title') }} />
      <T>{t('guard.passkey.intro')}</T>

      {keys.isLoading ? <Loading /> : null}
      {keys.error ? <T variant="error">{errorMessage(keys.error)}</T> : null}
      {keys.data ? (
        <Section>
          {keys.data.length === 0 ? <Row title={t('guard.passkey.none')} /> : null}
          {keys.data.map((k) => (
            <Row
              key={k.id}
              icon="finger-print"
              title={k.name}
              subtitle={k.last_used_at ? t('guard.passkey.lastUsed', { when: formatShort(k.last_used_at) }) : t('guard.passkey.neverUsed')}
              onPress={() => askRemove(k)}
              right={<Ionicons name="trash-outline" size={20} color={colors.danger} accessibilityLabel={`${t('guard.passkey.remove')} ${k.name}`} />}
            />
          ))}
        </Section>
      ) : null}

      {removing ? (
        <View style={{ gap: spacing.md }}>
          <T variant="label">{removing.name}</T>
          {codeField}
          <Button title={t('guard.passkey.remove')} variant="danger" loading={remove.isPending} disabled={!codeOk} onPress={() => remove.mutate(removing.id)} />
          <Button title={t('common.cancel')} variant="ghost" onPress={() => { setRemoving(null); setCode('') }} />
        </View>
      ) : !supported ? (
        <T variant="muted">{t('guard.passkey.unsupported')}</T>
      ) : !totpOn ? (
        <>
          <T variant="muted">{t('guard.passkey.needTotp')}</T>
          <Button title={t('settings.security.twoFactor')} variant="secondary" icon="shield-checkmark-outline" onPress={() => router.push('/settings/two-factor')} />
        </>
      ) : (
        <View style={{ gap: spacing.md }}>
          <TextField label={t('guard.passkey.namePrompt')} value={name} onChangeText={setName} maxLength={64} autoCapitalize="sentences" />
          {codeField}
          <Button
            title={t('guard.passkey.add')}
            icon="add-circle-outline"
            loading={add.isPending}
            disabled={!name.trim() || !codeOk}
            onPress={() => add.mutate()}
          />
        </View>
      )}
    </ScrollView>
  )
}
