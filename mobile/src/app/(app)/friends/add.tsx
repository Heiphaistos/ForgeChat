import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, Share, View } from 'react-native'
import { friendsApi, type FriendSuggestion } from '@/api/friends'
import { Avatar } from '@/components/Avatar'
import { Button, IconButton, Row, Section, T, TextField } from '@/components/ui'
import { t as tr, useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { colors, spacing } from '@/theme'

function suggestionReason(s: FriendSuggestion): string {
  const parts = []
  if (s.mutual_friends) parts.push(tr(s.mutual_friends > 1 ? 'social.addFriend.mutualFriendsMany' : 'social.addFriend.mutualFriends', { n: s.mutual_friends }))
  if (s.mutual_servers) parts.push(tr(s.mutual_servers > 1 ? 'social.addFriend.mutualServersMany' : 'social.addFriend.mutualServers', { n: s.mutual_servers }))
  return parts.join(' · ')
}

export default function AddFriendScreen() {
  const t = useT()
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const suggestions = useQuery({ queryKey: ['friend-suggestions'], queryFn: friendsApi.suggestions })
  // Tout l'annuaire de l'instance, filtré pendant la frappe : le #tag n'est pas nécessaire.
  const query = name.trim().toLowerCase().split('#')[0] ?? ''
  const shown = (suggestions.data ?? []).filter((s) => !query || s.username.toLowerCase().includes(query))

  const submit = async () => {
    const n = name.trim()
    if (!/^[\p{L}\p{N}_-]{2,32}(#\d{4})?$/u.test(n)) {
      setError(t('social.addFriend.badFormat'))
      return
    }
    setLoading(true)
    setError(null)
    try {
      const r = await friendsApi.addByName(n, message)
      void queryClient.invalidateQueries({ queryKey: qk.friendsAll })
      Alert.alert(t('friends.sent'), t(r?.outcome === 'accepted' ? 'social.addFriend.nowFriends' : 'social.addFriend.sentTo', { name: n }))
      router.back()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  const shareInvite = async () => {
    setInviting(true)
    try {
      const { url } = await friendsApi.createInvite()
      await Share.share({ message: t('social.addFriend.shareMessage', { url }) })
    } catch (e) {
      Alert.alert(t('social.addFriend.linkUnavailable'), errorMessage(e))
    } finally {
      setInviting(false)
    }
  }

  const addSuggested = async (s: FriendSuggestion) => {
    try {
      const r = await friendsApi.addByName(`${s.username}#${s.discriminator}`)
      void queryClient.invalidateQueries({ queryKey: qk.friendsAll })
      void suggestions.refetch()
      Alert.alert(t('friends.sent'), t(r?.outcome === 'accepted' ? 'social.addFriend.nowFriends' : 'social.addFriend.sentTo', { name: s.username }))
    } catch (e) {
      Alert.alert(t('social.addFriend.failed'), errorMessage(e))
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <T variant="muted">{t('social.addFriend.intro')}</T>
      <TextField label={t('social.addFriend.username')} placeholder={t('social.addFriend.usernamePlaceholder')} value={name} onChangeText={setName} autoCapitalize="none" autoCorrect={false} error={error} />
      <TextField label={t('social.addFriend.message')} value={message} onChangeText={setMessage} maxLength={200} />
      <Button title={t('social.addFriend.send')} onPress={submit} loading={loading} />

      {shown.length || query ? (
        <Section title={t('social.addFriend.members')}>
          {!shown.length ? <T variant="muted" style={{ padding: spacing.md }}>{t('social.addFriend.noMatch')}</T> : null}
          {shown.map((s) => (
            <Row
              key={s.id}
              title={s.username}
              subtitle={suggestionReason(s)}
              onPress={() => router.push(`/user/${s.id}`)}
              right={
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Avatar uri={s.avatar} name={s.username} size={28} />
                  <IconButton icon="person-add-outline" label={t('social.addFriend.addName', { name: s.username })} color={colors.success} onPress={() => void addSuggested(s)} />
                </View>
              }
            />
          ))}
        </Section>
      ) : null}

      <Section title={t('social.addFriend.inviteLink')} footer={t('social.addFriend.inviteFooter')}>
        <View style={{ padding: spacing.md }}>
          <Button title={t('social.addFriend.shareLink')} variant="secondary" icon="share-outline" onPress={() => void shareInvite()} loading={inviting} />
        </View>
      </Section>

    </ScrollView>
  )
}
