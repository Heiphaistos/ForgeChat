import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, View } from 'react-native'
import { serversApi } from '@/api/servers'
import { Avatar } from '@/components/Avatar'
import { Sheet, type SheetAction } from '@/components/Sheet'
import { Button, ErrorState, Loading, Section, SwitchRow, T } from '@/components/ui'
import { MemberTags, ModNotes, VoiceModeration } from '@/features/servers/MemberAdmin'
import { useServerDetail, useServerPerms } from '@/features/servers/menus'
import { PERM, memberActions } from '@/features/servers/perms'
import { useT, type Key } from '@/i18n'
import { formatShort } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { useNow } from '@/lib/useNow'
import { qk, queryClient } from '@/lib/queryClient'
import { colors, spacing } from '@/theme'

const TIMEOUTS: { label: Key; minutes: number }[] = [
  { label: 'serverSettings.dur.5min', minutes: 5 },
  { label: 'serverSettings.dur.1h', minutes: 60 },
  { label: 'serverSettings.dur.1d', minutes: 1440 },
  { label: 'serverSettings.dur.1w', minutes: 10080 },
]
const TEMP_BANS: { label: Key; hours: number }[] = [
  { label: 'serverSettings.dur.1d', hours: 24 },
  { label: 'serverSettings.dur.7d', hours: 168 },
  { label: 'serverSettings.dur.30d', hours: 720 },
]

/** Gestion d'un membre : rôles, tags, vocal, notes, exclusion temporaire, expulsion, bannissement. */
export default function ManageMemberScreen() {
  const { valid, ids } = useRouteParams(['serverId', 'userId'] as const)
  const sid = ids.serverId ?? ''
  const members = useQuery({ queryKey: qk.members(sid), queryFn: () => serversApi.members(sid), enabled: valid })
  const detail = useServerDetail(sid, valid)
  const perms = useServerPerms(sid, valid)
  const [sheet, setSheet] = useState<'timeout' | 'ban' | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const member = members.data?.find((m) => m.user_id === ids.userId)
  const now = useNow(30_000)
  const t = useT()

  if (!valid) return <ErrorState message={t('serverSettings.member.invalid')} />
  if (members.isLoading || detail.isLoading) return <Loading />
  if (!member) return <ErrorState message={members.error ? errorMessage(members.error) : t('serverSettings.member.gone')} />
  const can = memberActions(perms, member)
  const name = member.nickname || member.username

  const run = async (key: string, fn: () => Promise<unknown>, done?: () => void) => {
    setBusy(key)
    try {
      await fn()
      await queryClient.invalidateQueries({ queryKey: qk.members(sid) })
      done?.()
    } catch (e) {
      Alert.alert(t('common.actionFailed'), errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const confirm = (title: string, label: string, fn: () => Promise<unknown>) =>
    Alert.alert(title, undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: label, style: 'destructive', onPress: () => void run(label, fn, () => router.back()) },
    ])

  const roles = [...(detail.data?.roles ?? [])].filter((r) => !r.is_everyone).sort((a, b) => b.position - a.position)
  const mine = new Set(member.role_ids ?? [])
  // Vocal : le serveur accepte aussi d'agir sur soi-même (voice_moderation.rs).
  const voiceTarget = member.user_id === perms.meId || perms.outranks(member)
  const voice = { mute: voiceTarget && perms.has(PERM.MUTE_MEMBERS), deafen: voiceTarget && perms.has(PERM.DEAFEN_MEMBERS), move: voiceTarget && perms.has(PERM.MOVE_MEMBERS) }
  const timedOut = !!member.timeout_until && new Date(member.timeout_until).getTime() > now

  const sheetActions: SheetAction[] =
    sheet === 'timeout'
      ? TIMEOUTS.map((d) => ({
          label: t('serverSettings.member.timeoutFor', { duration: t(d.label) }),
          icon: 'time-outline',
          onPress: () => void run('timeout', () => serversApi.timeout(sid, member.user_id, d.minutes)),
        }))
      : [
          ...TEMP_BANS.map((b) => ({
            label: t('serverSettings.member.banFor', { duration: t(b.label) }),
            icon: 'ban-outline' as const,
            onPress: () =>
              confirm(t('serverSettings.member.banConfirm', { name, duration: t(b.label) }), t('serverSettings.member.ban'), () =>
                serversApi.ban(sid, member.user_id, undefined, b.hours),
              ),
          })),
          ...(can.banForever
            ? [
                {
                  label: t('serverSettings.perm.banForever'),
                  icon: 'ban' as const,
                  danger: true,
                  onPress: () => confirm(t('serverSettings.member.banForeverConfirm', { name }), t('serverSettings.member.ban'), () => serversApi.ban(sid, member.user_id)),
                },
              ]
            : []),
        ]

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Avatar uri={member.avatar} name={member.username} size={56} />
        <View style={{ flex: 1 }}>
          <T variant="subtitle" numberOfLines={1}>
            {name}
          </T>
          {member.nickname ? <T variant="muted">{member.username}</T> : null}
          {timedOut ? <T variant="muted">{t('serverSettings.member.timedOutUntil', { date: formatShort(member.timeout_until) })}</T> : null}
        </View>
      </View>
      {can.roles && roles.length ? (
        <Section title={t('screen.roles')}>
          {roles.map((r) => (
            <SwitchRow
              key={r.id}
              title={r.name}
              value={mine.has(r.id)}
              disabled={!perms.roleBelow(r) || busy !== null}
              onValueChange={(on) =>
                void run(r.id, () => (on ? serversApi.assignRole(sid, member.user_id, r.id) : serversApi.removeRole(sid, member.user_id, r.id)))
              }
            />
          ))}
        </Section>
      ) : null}
      {perms.has(PERM.MANAGE_ROLES) ? <MemberTags serverId={sid} userId={member.user_id} /> : null}
      {voice.mute || voice.deafen || voice.move ? <VoiceModeration serverId={sid} userId={member.user_id} channels={detail.data?.channels ?? []} can={voice} /> : null}
      {perms.has(PERM.MANAGE_MESSAGES) ? <ModNotes serverId={sid} userId={member.user_id} /> : null}
      {can.timeout ? (
        timedOut ? (
          <Button title={t('serverSettings.member.untimeout')} variant="secondary" icon="time-outline" loading={busy === 'untimeout'} onPress={() => void run('untimeout', () => serversApi.removeTimeout(sid, member.user_id))} />
        ) : (
          <Button title={t('serverSettings.member.timeout')} variant="secondary" icon="time-outline" loading={busy === 'timeout'} onPress={() => setSheet('timeout')} />
        )
      ) : null}
      {can.kick ? <Button title={t('serverSettings.member.kickNamed', { name })}
          variant="danger"
          icon="exit-outline"
          onPress={() => confirm(t('serverSettings.member.kickConfirm', { name }), t('serverSettings.member.kick'), () => serversApi.kick(sid, member.user_id))}
        /> : null}
      {can.ban ? <Button title={t('serverSettings.member.banNamed', { name })} variant="danger" icon="ban-outline" onPress={() => setSheet('ban')} /> : null}
      {!can.roles && !can.timeout && !can.kick && !can.ban && !voice.mute && !voice.deafen && !voice.move ? <T variant="muted">{t('serverSettings.member.noAction')}</T> : null}
      <Sheet visible={sheet !== null} onClose={() => setSheet(null)} title={t(sheet === 'timeout' ? 'serverSettings.member.timeoutSheet' : 'serverSettings.member.banSheet')} actions={sheetActions} />
    </ScrollView>
  )
}
