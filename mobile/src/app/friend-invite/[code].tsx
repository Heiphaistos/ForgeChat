import { useQuery } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'
import { friendInviteApi } from '@/api/friends'
import { Avatar } from '@/components/Avatar'
import { Button, ErrorState, Loading } from '@/components/ui'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { INVITE_CODE_RE } from '@/lib/validation'
import { useAuth } from '@/stores/auth'
import { colors, font, spacing } from '@/theme'

export default function FriendInviteLanding() {
  const { code: raw } = useLocalSearchParams<{ code: string }>()
  const code = typeof raw === 'string' && INVITE_CODE_RE.test(raw) ? raw : null
  const signedIn = useAuth((s) => s.status === 'signedIn')
  const [busy, setBusy] = useState(false)
  const info = useQuery({ queryKey: ['friend-invite', code], queryFn: () => friendInviteApi.get(code!), enabled: !!code, retry: false })

  if (!code) return <ErrorState message="Lien invalide." />
  if (info.isLoading) return <Loading />
  if (info.error || !info.data) return <ErrorState message={errorMessage(info.error, 'Invitation expirée ou introuvable.')} />
  const u = info.data.user

  const accept = async () => {
    setBusy(true)
    try {
      await friendInviteApi.accept(code)
      void queryClient.invalidateQueries({ queryKey: qk.friendsAll })
      router.replace('/friends')
    } catch (e) {
      Alert.alert('Impossible d’accepter', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.container}>
      <Avatar uri={u.avatar} name={u.username} size={96} />
      <Text style={styles.name}>{u.username}</Text>
      <Text style={styles.sub}>t’invite à devenir ami sur ForgeChat</Text>
      {signedIn ? (
        <Button title="Accepter" onPress={accept} loading={busy} style={{ alignSelf: 'stretch', marginTop: spacing.xl }} />
      ) : (
        <Button title="Se connecter" onPress={() => router.replace('/login')} style={{ alignSelf: 'stretch', marginTop: spacing.xl }} />
      )}
      <Button title="Fermer" variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  name: { color: colors.text, fontSize: font.xxl, fontWeight: '800' },
  sub: { color: colors.textMuted, fontSize: font.md, textAlign: 'center' },
})
