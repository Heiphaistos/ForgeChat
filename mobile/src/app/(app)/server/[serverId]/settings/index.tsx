import { router } from 'expo-router'
import { ScrollView } from 'react-native'
import { ErrorState, Loading, Row, Section } from '@/components/ui'
import type { IconName } from '@/components/ui'
import { useServerDetail, useServerPerms } from '@/features/servers/menus'
import { settingsSections, type SettingsSection } from '@/features/servers/perms'
import { useT, type Key } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { colors, spacing } from '@/theme'

const ENTRIES: Record<Exclude<SettingsSection, 'danger'>, { title: Key; icon: IconName; path: string }> = {
  overview: { title: 'screen.overview', icon: 'information-circle-outline', path: 'settings/overview' },
  advanced: { title: 'serverSettings.title.advanced', icon: 'options-outline', path: 'settings/advanced' },
  channels: { title: 'screen.channels', icon: 'list-outline', path: 'settings/channels' },
  roles: { title: 'screen.roles', icon: 'shield-outline', path: 'settings/roles' },
  tags: { title: 'serverSettings.title.tags', icon: 'pricetag-outline', path: 'settings/tags' },
  members: { title: 'screen.members', icon: 'people-outline', path: 'settings/members' },
  reports: { title: 'serverSettings.title.reports', icon: 'flag-outline', path: 'settings/reports' },
  bans: { title: 'screen.bans', icon: 'ban-outline', path: 'settings/bans' },
  invites: { title: 'screen.invites', icon: 'link-outline', path: 'settings/invites' },
  emojis: { title: 'serverSettings.title.emojis', icon: 'happy-outline', path: 'settings/emojis' },
  webhooks: { title: 'serverSettings.title.webhooks', icon: 'git-network-outline', path: 'settings/webhooks' },
  bots: { title: 'bots.title', icon: 'hardware-chip-outline', path: 'settings/bots' },
  discordSync: { title: 'dsync.title', icon: 'logo-discord', path: 'settings/discord-sync' },
  audit: { title: 'serverSettings.title.audit', icon: 'document-text-outline', path: 'settings/audit' },
  automod: { title: 'serverSettings.title.automod', icon: 'shield-checkmark-outline', path: 'settings/automod' },
  stats: { title: 'serverSettings.title.stats', icon: 'stats-chart-outline', path: 'settings/stats' },
  community: { title: 'community.settings.title', icon: 'trophy-outline', path: 'settings/community' },
  onboarding: { title: 'screen.onboardingSettings', icon: 'sparkles-outline', path: 'settings/onboarding' },
}

/** Paramètres du serveur : seules les rubriques autorisées par les droits de l'utilisateur. */
export default function ServerSettingsScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const detail = useServerDetail(ids.serverId ?? '', valid)
  const perms = useServerPerms(ids.serverId ?? '', valid)
  const t = useT()
  if (!valid) return <ErrorState message={t('serverSettings.invalidServer')} />
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
            <Row key={s} icon={ENTRIES[s].icon} title={t(ENTRIES[s].title)} chevron onPress={() => go(ENTRIES[s].path)} />
          ))}
        {/* Clé de récupération du serveur : propriétaire seulement (description pour les autres). */}
        <Row icon="key-outline" title={t('e2e.serverKey.title')} chevron onPress={() => go('settings/encryption')} />
      </Section>
      {sections.includes('danger') ? (
        <Section title={t('serverSettings.danger')}>
          <Row icon="swap-horizontal-outline" title={t('screen.transfer')} chevron onPress={() => go('settings/transfer')} />
          <Row icon="trash-outline" title={t('screen.deleteServer')} danger chevron onPress={() => go('delete')} />
        </Section>
      ) : null}
    </ScrollView>
  )
}
