import { router } from 'expo-router'
import { ScrollView } from 'react-native'
import { ErrorState, Loading, Row, Section } from '@/components/ui'
import type { IconName } from '@/components/ui'
import { useServerDetail, useServerPerms } from '@/features/servers/menus'
import { settingsSections, type SettingsSection } from '@/features/servers/perms'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { colors, spacing } from '@/theme'

const ENTRIES: Record<Exclude<SettingsSection, 'danger'>, { title: string; icon: IconName; path: string }> = {
  overview: { title: "Vue d'ensemble", icon: 'information-circle-outline', path: 'settings/overview' },
  advanced: { title: 'Réglages avancés', icon: 'options-outline', path: 'settings/advanced' },
  channels: { title: 'Salons et catégories', icon: 'list-outline', path: 'settings/channels' },
  roles: { title: 'Rôles', icon: 'shield-outline', path: 'settings/roles' },
  tags: { title: 'Tags de clan', icon: 'pricetag-outline', path: 'settings/tags' },
  members: { title: 'Membres', icon: 'people-outline', path: 'settings/members' },
  reports: { title: 'Signalements', icon: 'flag-outline', path: 'settings/reports' },
  bans: { title: 'Bannissements', icon: 'ban-outline', path: 'settings/bans' },
  invites: { title: 'Invitations', icon: 'link-outline', path: 'settings/invites' },
  emojis: { title: 'Emojis et stickers', icon: 'happy-outline', path: 'settings/emojis' },
  webhooks: { title: 'Webhooks', icon: 'git-network-outline', path: 'settings/webhooks' },
  audit: { title: "Journal d'audit", icon: 'document-text-outline', path: 'settings/audit' },
  automod: { title: 'AutoMod', icon: 'shield-checkmark-outline', path: 'settings/automod' },
  stats: { title: 'Statistiques', icon: 'stats-chart-outline', path: 'settings/stats' },
}

/** Paramètres du serveur : seules les rubriques autorisées par les droits de l'utilisateur. */
export default function ServerSettingsScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const detail = useServerDetail(ids.serverId ?? '', valid)
  const perms = useServerPerms(ids.serverId ?? '', valid)
  if (!valid) return <ErrorState message="Serveur invalide." />
  if (detail.isLoading) return <Loading />
  if (detail.error) return <ErrorState message={errorMessage(detail.error)} onRetry={() => void detail.refetch()} />
  const sections = settingsSections(perms)
  const go = (p: string) => router.push(`/server/${ids.serverId}/${p}` as never)

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }}>
      <Section title={detail.data?.server.name}>
        {sections
          .filter((s): s is Exclude<SettingsSection, 'danger'> => s !== 'danger')
          .map((s) => (
            <Row key={s} icon={ENTRIES[s].icon} title={ENTRIES[s].title} chevron onPress={() => go(ENTRIES[s].path)} />
          ))}
      </Section>
      {sections.includes('danger') ? (
        <Section title="Zone de danger">
          <Row icon="swap-horizontal-outline" title="Transférer la propriété" chevron onPress={() => go('settings/transfer')} />
          <Row icon="trash-outline" title="Supprimer le serveur" danger chevron onPress={() => go('delete')} />
        </Section>
      ) : null}
    </ScrollView>
  )
}
