import { Ionicons } from '@expo/vector-icons'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Stack, router } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, Share } from 'react-native'
import { settingsApi, settingsKey, type ServerSideSettings } from '@/api/settings'
import { usersApi } from '@/api/users'
import { ErrorState, Loading, Row, Section, SwitchRow } from '@/components/ui'
import { EXPORT_SHARE_MAX_CHARS } from '@/features/account/rules'
import { errorMessage } from '@/lib/http'
import { queryClient } from '@/lib/queryClient'
import { colors, spacing } from '@/theme'

type ChoiceKey = 'activity_visibility' | 'friend_request_from' | 'explicit_content_filter'

const CHOICES: { key: ChoiceKey; title: string; options: { v: string; label: string }[] }[] = [
  {
    key: 'activity_visibility',
    title: 'Qui peut voir mon activité',
    options: [
      { v: 'everyone', label: 'Tout le monde' },
      { v: 'friends', label: 'Amis uniquement' },
      { v: 'nobody', label: 'Personne' },
    ],
  },
  {
    key: 'friend_request_from',
    title: 'Qui peut m’envoyer une demande d’ami',
    options: [
      { v: 'everyone', label: 'Tout le monde' },
      { v: 'friends_of_friends', label: 'Amis d’amis' },
      { v: 'nobody', label: 'Personne' },
    ],
  },
  {
    key: 'explicit_content_filter',
    title: 'Filtre de contenu explicite',
    options: [
      { v: 'none', label: 'Désactivé' },
      { v: 'members_without_roles', label: 'Membres sans rôles' },
      { v: 'all', label: 'Tous les messages' },
    ],
  },
]

/** Confidentialité côté serveur (partagée avec le web et le bureau) + export RGPD. */
export default function PrivacyScreen() {
  const q = useQuery({ queryKey: settingsKey, queryFn: settingsApi.get })
  const [exporting, setExporting] = useState(false)
  const save = useMutation({
    mutationFn: (patch: Partial<ServerSideSettings>) => settingsApi.update(patch),
    onMutate: (patch) => queryClient.setQueryData<ServerSideSettings>(settingsKey, (old) => (old ? { ...old, ...patch } : old)),
    onSuccess: (data) => queryClient.setQueryData(settingsKey, data),
    onError: (e) => {
      void q.refetch()
      Alert.alert('Réglage non enregistré', errorMessage(e))
    },
  })

  const exportData = async () => {
    setExporting(true)
    try {
      const text = JSON.stringify(await usersApi.dataExport(), null, 2)
      if (text.length > EXPORT_SHARE_MAX_CHARS) {
        Alert.alert(
          'Export trop volumineux',
          'Tes données dépassent ce que le téléphone peut partager : télécharge-les depuis la version web (Paramètres, Confidentialité).',
        )
        return
      }
      await Share.share({ title: 'forgechat-mes-donnees.json', message: text })
    } catch (e) {
      Alert.alert('Export impossible', errorMessage(e))
    } finally {
      setExporting(false)
    }
  }

  if (q.isLoading) return <Loading />
  if (q.error || !q.data) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
  const s = q.data

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }}>
      <Stack.Screen options={{ title: 'Confidentialité' }} />
      <Section footer="Ces réglages s’appliquent à ton compte sur tous tes appareils.">
        <SwitchRow icon="radio-button-on-outline" title="Afficher mon statut en ligne" value={s.show_online} onValueChange={(v) => save.mutate({ show_online: v })} />
        <SwitchRow
          icon="chatbubbles-outline"
          title="Messages privés de tout le monde"
          subtitle="Désactivé : seuls tes amis peuvent t’écrire."
          value={s.dm_from_all}
          onValueChange={(v) => save.mutate({ dm_from_all: v })}
        />
      </Section>

      {CHOICES.map((c) => (
        <Section key={c.key} title={c.title}>
          {c.options.map((o) => (
            <Row
              key={o.v}
              title={o.label}
              selected={s[c.key] === o.v}
              onPress={() => save.mutate({ [c.key]: o.v })}
              right={s[c.key] === o.v ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
            />
          ))}
        </Section>
      ))}

      <Section title="Mes données">
        <Row icon="time-outline" title="Historique de connexion" onPress={() => router.push('/settings/login-history')} chevron />
        <Row icon="stats-chart-outline" title="Mes statistiques" onPress={() => router.push('/settings/stats')} chevron />
        <Row
          icon="download-outline"
          title={exporting ? 'Préparation de l’export…' : 'Exporter mes données'}
          subtitle="Profil, messages, serveurs et amis, au format JSON (RGPD)."
          onPress={exporting ? undefined : () => void exportData()}
        />
      </Section>
    </ScrollView>
  )
}
