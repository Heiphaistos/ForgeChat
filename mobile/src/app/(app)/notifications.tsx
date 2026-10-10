// Centre de notifications (même contenu que le web, client/src/pages/NotificationsPage.tsx) :
// pour chaque serveur, niveau, sourdine, @everyone, rôles, posts de forum, catégories et salons
// réglés à part ; puis les messages privés. Hiérarchie : salon > catégorie > serveur > défaut.
import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, RefreshControl, ScrollView, Text } from 'react-native'
import { dmsApi } from '@/api/dms'
import { serversApi } from '@/api/servers'
import { Sheet, type SheetAction } from '@/components/Sheet'
import { Button, ErrorState, Loading, Row, Section, SwitchRow } from '@/components/ui'
import { DEFAULT_SERVER, notifApi, serverDefault, useNotifCenter, type ServerPrefs } from '@/features/notifications/notifCenter'
import { resolveLevel, stillMuted, type NotifLevel } from '@/features/notifications/notifLevels'
import { useT, type Key } from '@/i18n'
import { formatTime } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { queryClient, qk } from '@/lib/queryClient'
import type { Server } from '@/types/models'
import { colors, font, spacing } from '@/theme'

const LEVEL_LABEL: Record<NotifLevel, Key> = {
  inherit: 'server.notifications.inherit',
  all: 'server.notifications.all',
  mentions: 'server.notifications.mentions',
  nothing: 'server.notifications.nothing',
}
const LEVELS: NotifLevel[] = ['inherit', 'all', 'mentions', 'nothing']
// Mêmes durées que l'écran de notifications d'un serveur ; 0 = jusqu'à réactivation.
const MUTES: { minutes: number; label: Key }[] = [
  { minutes: 15, label: 'server.notifications.mute15' },
  { minutes: 60, label: 'server.notifications.mute60' },
  { minutes: 480, label: 'server.notifications.mute480' },
  { minutes: 1440, label: 'server.notifications.mute1440' },
  { minutes: 0, label: 'server.notifications.muteForever' },
]

type Picker = { title: string; actions: SheetAction[] } | null

export default function NotificationCenterScreen() {
  const t = useT()
  const center = useNotifCenter()
  const servers = useQuery({ queryKey: qk.servers, queryFn: serversApi.list })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [picker, setPicker] = useState<Picker>(null)

  const refresh = () => center.fetch().then(() => setError(null), (e) => setError(errorMessage(e)))
  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const run = async (call: () => Promise<unknown>, done: Key) => {
    setBusy(true)
    try {
      await call()
      await refresh()
      void queryClient.invalidateQueries({ queryKey: ['notif'] })
      Alert.alert(t(done))
    } catch (e) {
      Alert.alert(t('ux.nc.saveError'), errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const resetAll = () =>
    Alert.alert(t('ux.nc.resetAll'), t('ux.nc.resetAllConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('ux.nc.resetAll'), style: 'destructive', onPress: () => void run(() => notifApi.reset(), 'ux.nc.resetDone') },
    ])

  if (error && !center.loaded) return <ErrorState message={error} onRetry={() => void refresh()} />
  if (!center.loaded || servers.isLoading) return <Loading />

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => void refresh()} tintColor={colors.textMuted} />}
    >
      <Text style={{ color: colors.textMuted, fontSize: font.sm, marginBottom: spacing.md }}>{t('ux.nc.intro')}</Text>
      <Button title={t('ux.nc.mentionsEverywhere')} icon="at" loading={busy} onPress={() => void run(() => notifApi.everywhere('mentions'), 'ux.nc.mentionsEverywhereDone')} />
      <Text style={{ color: colors.textMuted, fontSize: font.xs, marginVertical: spacing.sm }}>{t('ux.nc.mentionsEverywhereDesc')}</Text>
      <Section>
        <Row icon="refresh-outline" title={t('ux.nc.resetAll')} onPress={busy ? undefined : resetAll} />
        <Row icon="settings-outline" title={t('ux.nc.general')} onPress={() => router.push('/settings/notifications')} chevron />
      </Section>

      <Section title={t('ux.nc.servers')}>
        {(servers.data ?? []).length === 0 ? <Row title={t('ux.nc.noServers')} /> : null}
        {(servers.data ?? []).map((s) => (
          <ServerBlock key={s.id} server={s} setPicker={setPicker} />
        ))}
      </Section>

      <DmBlock />

      <Sheet visible={!!picker} onClose={() => setPicker(null)} title={picker?.title} actions={picker?.actions ?? []} />
    </ScrollView>
  )
}

function ServerBlock({ server, setPicker }: { server: Server; setPicker: (p: Picker) => void }) {
  const t = useT()
  const center = useNotifCenter()
  const [open, setOpen] = useState(false)
  const id = server.id
  const prefs = center.servers[id] ?? DEFAULT_SERVER
  const muted = stillMuted(prefs.muted, prefs.mutedUntil)
  const defaultLevel = resolveLevel(undefined, undefined, undefined, serverDefault(id))
  const categories = useQuery({ queryKey: qk.categories(id), queryFn: () => serversApi.categories(id), enabled: open })
  const channels = Object.entries(center.channels).filter(([, c]) => c.serverId === id && (c.level !== 'inherit' || stillMuted(c.muted, c.mutedUntil)))
  const custom = Object.values(center.categories).filter((c) => c.serverId === id).length + channels.length

  const fail = (e: unknown) => Alert.alert(t('ux.nc.saveError'), errorMessage(e))
  const save = async (patch: Partial<ServerPrefs>, muteMinutes?: number) => {
    const next = { ...prefs, ...patch }
    try {
      await notifApi.setServer(id, next, muteMinutes)
      await center.fetch()
    } catch (e) {
      fail(e)
    }
  }
  const after = (call: () => Promise<unknown>) => () => void call().then(() => center.fetch()).catch(fail)

  const levelName = (l: NotifLevel) => (l === 'inherit' ? t('ux.nc.defaultIs', { level: t(LEVEL_LABEL[defaultLevel]) }) : t(LEVEL_LABEL[l]))
  const muteLabel = muted
    ? prefs.mutedUntil ? t('server.notifications.mutedUntil', { time: formatTime(prefs.mutedUntil) }) : t('server.notifications.mutedForever')
    : t('server.notifications.on')
  const summary = [
    levelName(prefs.level),
    muted && muteLabel,
    prefs.suppressEveryone && t('ux.nc.everyoneIgnored'),
    prefs.suppressRoles && t('ux.nc.rolesIgnored'),
    prefs.forumPosts && t('ux.nc.forumOn'),
    custom > 0 && t('ux.nc.custom', { n: custom }),
  ].filter(Boolean).join(' · ')

  const pickLevel = () =>
    setPicker({
      title: t('ux.nc.level'),
      actions: LEVELS.map((l) => ({ label: levelName(l), icon: 'notifications-outline', selected: prefs.level === l, onPress: () => void save({ level: l }) })),
    })
  const pickMute = () =>
    setPicker({
      title: t('server.notifications.mute'),
      actions: [
        { label: t('server.notifications.on'), icon: 'notifications-outline', selected: !muted, onPress: () => void save({ muted: false }) },
        ...MUTES.map((m) => ({ label: t(m.label), icon: 'notifications-off-outline' as const, onPress: () => void save({ muted: true }, m.minutes) })),
      ],
    })
  const pickCategory = (categoryId: string, name: string) => {
    const current = center.categories[categoryId]?.level ?? 'inherit'
    setPicker({
      title: name,
      actions: LEVELS.map((l) => ({ label: t(LEVEL_LABEL[l]), icon: 'folder-outline', selected: current === l, onPress: after(() => notifApi.setCategory(categoryId, l)) })),
    })
  }

  return (
    <>
      <Row
        title={server.name}
        subtitle={summary}
        onPress={() => setOpen((o) => !o)}
        right={<Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textFaint} />}
      />
      {open ? (
        <>
          <Row icon="notifications-outline" title={t('ux.nc.level')} subtitle={levelName(prefs.level)} onPress={pickLevel} chevron />
          <Row icon="notifications-off-outline" title={t('server.notifications.mute')} subtitle={muteLabel} onPress={pickMute} chevron />
          <SwitchRow title={t('server.notifications.suppress')} value={prefs.suppressEveryone} onValueChange={(v) => void save({ suppressEveryone: v })} />
          <SwitchRow title={t('ux.nc.suppressRoles')} value={prefs.suppressRoles} onValueChange={(v) => void save({ suppressRoles: v })} />
          <SwitchRow title={t('ux.nc.forumPosts')} value={prefs.forumPosts} onValueChange={(v) => void save({ forumPosts: v })} />
          {categories.isLoading ? <Row title="…" /> : null}
          {categories.data?.length === 0 ? <Row title={t('ux.nc.noCategories')} /> : null}
          {(categories.data ?? []).map((c) => (
            <Row
              key={c.id}
              icon="folder-outline"
              title={c.name}
              subtitle={`${t('ux.nc.categoriesDesc')} : ${t(LEVEL_LABEL[center.categories[c.id]?.level ?? 'inherit'])}`}
              onPress={() => pickCategory(c.id, c.name)}
              chevron
            />
          ))}
          {channels.map(([ch, c]) => (
            <Row
              key={ch}
              icon="close-circle-outline"
              title={`#${c.name ?? '?'}`}
              subtitle={[c.level !== 'inherit' && t(LEVEL_LABEL[c.level]), stillMuted(c.muted, c.mutedUntil) && t('ux.nc.muted')].filter(Boolean).join(' · ')}
              onPress={after(() => serversApi.setChannelNotif(ch, 'inherit', false, undefined))}
            />
          ))}
          <Row icon="refresh-outline" title={t('ux.nc.resetServer')} onPress={after(() => notifApi.reset(id))} />
        </>
      ) : null}
    </>
  )
}

function DmBlock() {
  const t = useT()
  const convs = useQuery({ queryKey: qk.conversations, queryFn: dmsApi.list })
  const setMuted = (dmId: string, muted: boolean) =>
    dmsApi.setSettings(dmId, { muted }).then(
      () => queryClient.invalidateQueries({ queryKey: qk.conversations }),
      (e) => Alert.alert(t('ux.nc.saveError'), errorMessage(e)),
    )
  return (
    <Section title={t('ux.nc.dms')} footer={t('ux.nc.dmsDesc')}>
      {convs.data?.length === 0 ? <Row title={t('ux.nc.noDms')} /> : null}
      {(convs.data ?? []).map((c) => (
        <SwitchRow key={c.id} title={c.is_group ? c.name : c.username} value={!c.is_muted} onValueChange={(on) => void setMuted(c.id, !on)} />
      ))}
    </Section>
  )
}
