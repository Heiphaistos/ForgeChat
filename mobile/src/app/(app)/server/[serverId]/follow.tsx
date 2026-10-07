import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView } from 'react-native'
import { announcementsApi } from '@/api/announcements'
import { Button, EmptyState, ErrorState, Loading, Row, Section, T } from '@/components/ui'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { colors, spacing } from '@/theme'

/** Suivre un salon d'annonces : choisir un salon texte d'un serveur qu'on gère (web : FollowChannelModal.tsx). */
export default function FollowChannelScreen() {
  const t = useT()
  const { valid, ids, text } = useRouteParams(['serverId', 'channelId'] as const, ['name'])
  const targets = useQuery({ queryKey: ['follow-targets', ids.channelId], queryFn: () => announcementsApi.targets(ids.channelId), enabled: valid })
  const [target, setTarget] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!valid) return <ErrorState message={t('server.invalidChannel')} />
  if (targets.isLoading) return <Loading />
  if (targets.error) return <ErrorState message={errorMessage(targets.error)} onRetry={() => void targets.refetch()} />
  if (!targets.data?.length)
    return <EmptyState icon="megaphone-outline" title={t('server.follow.emptyTitle')} subtitle={t('server.follow.emptyBody')} />

  const follow = async () => {
    if (!target) return
    setBusy(true)
    try {
      await announcementsApi.follow(ids.channelId, target)
      Alert.alert(t('server.follow.doneTitle'), t('server.follow.doneBody', { name: text.name ?? t('server.follow.thisChannel') }))
      router.back()
    } catch (e) {
      Alert.alert(t('server.follow.failed'), errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }}>
      <T variant="muted" style={{ marginBottom: spacing.lg }}>
        {t('server.follow.intro', { name: text.name ?? t('server.follow.thisChannel') })}
      </T>
      {targets.data.map((s) => (
        <Section key={s.server_id} title={s.server_name}>
          {s.channels.map((c) => (
            <Row key={c.id} icon="chatbubble-outline" title={`# ${c.name}`} selected={target === c.id} onPress={() => setTarget(c.id)}
              right={target === c.id ? <T variant="label">✓</T> : null} />
          ))}
        </Section>
      ))}
      <Button title={t('server.follow.submit')} icon="megaphone-outline" onPress={() => void follow()} loading={busy} disabled={!target} />
    </ScrollView>
  )
}
