import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, Share, View } from 'react-native'
import { friendsApi, type FriendSuggestion } from '@/api/friends'
import { Avatar } from '@/components/Avatar'
import { Button, IconButton, Row, Section, T, TextField } from '@/components/ui'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { colors, spacing } from '@/theme'

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`

function suggestionReason(s: FriendSuggestion): string {
  const parts = []
  if (s.mutual_friends) parts.push(`${plural(s.mutual_friends, 'ami')} en commun`)
  if (s.mutual_servers) parts.push(`${plural(s.mutual_servers, 'serveur')} en commun`)
  return parts.join(' · ')
}

export default function AddFriendScreen() {
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const suggestions = useQuery({ queryKey: ['friend-suggestions'], queryFn: friendsApi.suggestions })

  const submit = async () => {
    const n = name.trim()
    if (!/^[\p{L}\p{N}_-]{2,32}(#\d{4})?$/u.test(n)) {
      setError('Format attendu : pseudo ou pseudo#1234')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await friendsApi.addByName(n, message)
      void queryClient.invalidateQueries({ queryKey: qk.friendsAll })
      Alert.alert('Demande envoyée', `Ta demande a été envoyée à ${n}.`)
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
      await Share.share({ message: `Ajoute-moi en ami sur ForgeChat : ${url}` })
    } catch (e) {
      Alert.alert('Lien indisponible', errorMessage(e))
    } finally {
      setInviting(false)
    }
  }

  const addSuggested = async (s: FriendSuggestion) => {
    try {
      await friendsApi.addByName(`${s.username}#${s.discriminator}`)
      void queryClient.invalidateQueries({ queryKey: qk.friendsAll })
      void suggestions.refetch()
      Alert.alert('Demande envoyée', `Ta demande a été envoyée à ${s.username}.`)
    } catch (e) {
      Alert.alert('Demande impossible', errorMessage(e))
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <T variant="muted">Tu peux ajouter un ami avec son pseudo ForgeChat (et son tag si besoin).</T>
      <TextField label="Pseudo" placeholder="pseudo#1234" value={name} onChangeText={setName} autoCapitalize="none" autoCorrect={false} error={error} />
      <TextField label="Message (optionnel)" value={message} onChangeText={setMessage} maxLength={200} />
      <Button title="Envoyer la demande" onPress={submit} loading={loading} />

      <Section title="Lien d’invitation" footer="Toute personne qui ouvre le lien peut t’ajouter en ami. Valable 7 jours.">
        <View style={{ padding: spacing.md }}>
          <Button title="Partager un lien d’invitation" variant="secondary" icon="share-outline" onPress={() => void shareInvite()} loading={inviting} />
        </View>
      </Section>

      {suggestions.data?.length ? (
        <Section title="Suggestions">
          {suggestions.data.map((s) => (
            <Row
              key={s.id}
              title={s.username}
              subtitle={suggestionReason(s)}
              onPress={() => router.push(`/user/${s.id}`)}
              right={
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Avatar uri={s.avatar} name={s.username} size={28} />
                  <IconButton icon="person-add-outline" label={`Ajouter ${s.username}`} color={colors.success} onPress={() => void addSuggested(s)} />
                </View>
              }
            />
          ))}
        </Section>
      ) : null}
    </ScrollView>
  )
}
