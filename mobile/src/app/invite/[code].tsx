import { useQuery } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'
import { serversApi } from '@/api/servers'
import { Avatar } from '@/components/Avatar'
import { Button, ErrorState, Loading } from '@/components/ui'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { INVITE_CODE_RE } from '@/lib/validation'
import { useAuth } from '@/stores/auth'
import { useUi } from '@/stores/ui'
import { colors, font, spacing } from '@/theme'

export default function InviteLanding() {
  const t = useT()
  const { code: raw } = useLocalSearchParams<{ code: string }>()
  const code = typeof raw === 'string' && INVITE_CODE_RE.test(raw) ? raw : null
  const signedIn = useAuth((s) => s.status === 'signedIn')
  const [joining, setJoining] = useState(false)
  const info = useQuery({ queryKey: ['invite', code], queryFn: () => serversApi.invite(code!), enabled: !!code, retry: false })

  if (!code) return <ErrorState message={t('social.invite.invalid')} />
  if (info.isLoading) return <Loading />
  if (info.error || !info.data) return <ErrorState message={errorMessage(info.error, t('social.invite.expired'))} />

  const s = info.data.server
  const join = async () => {
    setJoining(true)
    try {
      const server = await serversApi.join(code)
      await queryClient.invalidateQueries({ queryKey: qk.servers })
      useUi.getState().selectServer(server.id)
      router.replace('/')
    } catch (e) {
      Alert.alert(t('voice.joinFailed'), errorMessage(e))
    } finally {
      setJoining(false)
    }
  }

  return (
    <View style={styles.container}>
      <Avatar uri={s.icon} name={s.name} size={96} rounded={false} />
      <Text style={styles.sub}>{t('social.invite.invited')}</Text>
      <Text style={styles.name}>{s.name}</Text>
      <Text style={styles.sub}>{t('dms.members', { n: s.member_count })}</Text>
      {signedIn ? (
        <Button title={t('social.invite.join')} onPress={join} loading={joining} style={{ alignSelf: 'stretch', marginTop: spacing.xl }} />
      ) : (
        <>
          <Text style={[styles.sub, { marginTop: spacing.xl }]}>{t('social.invite.signInFirst')}</Text>
          <Button title={t('auth.login')} onPress={() => router.replace('/login')} style={{ alignSelf: 'stretch', marginTop: spacing.md }} />
        </>
      )}
      <Button title={t('common.close')} variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  name: { color: colors.text, fontSize: font.xxl, fontWeight: '800', textAlign: 'center' },
  sub: { color: colors.textMuted, fontSize: font.md, textAlign: 'center' },
})
