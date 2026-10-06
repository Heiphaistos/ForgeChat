import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, View } from 'react-native'
import { serversApi } from '@/api/servers'
import { Avatar } from '@/components/Avatar'
import { Sheet, type SheetAction } from '@/components/Sheet'
import { Button, ErrorState, Loading, Section, SwitchRow, T } from '@/components/ui'
import { useServerDetail, useServerPerms } from '@/features/servers/menus'
import { memberActions } from '@/features/servers/perms'
import { formatShort } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { useNow } from '@/lib/useNow'
import { qk, queryClient } from '@/lib/queryClient'
import { colors, spacing } from '@/theme'

const TIMEOUTS = [
  { label: '5 minutes', minutes: 5 },
  { label: '1 heure', minutes: 60 },
  { label: '1 jour', minutes: 1440 },
  { label: '1 semaine', minutes: 10080 },
]
const TEMP_BANS = [
  { label: '1 jour', hours: 24 },
  { label: '7 jours', hours: 168 },
  { label: '30 jours', hours: 720 },
]

/** Gestion d'un membre : rôles, exclusion temporaire, expulsion, bannissement. */
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

  if (!valid) return <ErrorState message="Membre invalide." />
  if (members.isLoading || detail.isLoading) return <Loading />
  if (!member) return <ErrorState message={members.error ? errorMessage(members.error) : 'Ce membre n’est plus sur le serveur.'} />
  const can = memberActions(perms, member)
  const name = member.nickname || member.username

  const run = async (key: string, fn: () => Promise<unknown>, done?: () => void) => {
    setBusy(key)
    try {
      await fn()
      await queryClient.invalidateQueries({ queryKey: qk.members(sid) })
      done?.()
    } catch (e) {
      Alert.alert('Action impossible', errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const confirm = (title: string, label: string, fn: () => Promise<unknown>) =>
    Alert.alert(title, undefined, [
      { text: 'Annuler', style: 'cancel' },
      { text: label, style: 'destructive', onPress: () => void run(label, fn, () => router.back()) },
    ])

  const roles = [...(detail.data?.roles ?? [])].filter((r) => !r.is_everyone).sort((a, b) => b.position - a.position)
  const mine = new Set(member.role_ids ?? [])
  const timedOut = !!member.timeout_until && new Date(member.timeout_until).getTime() > now

  const sheetActions: SheetAction[] =
    sheet === 'timeout'
      ? TIMEOUTS.map((t) => ({ label: `Exclure ${t.label}`, icon: 'time-outline', onPress: () => void run('timeout', () => serversApi.timeout(sid, member.user_id, t.minutes)) }))
      : [
          ...TEMP_BANS.map((b) => ({
            label: `Bannir ${b.label}`,
            icon: 'ban-outline' as const,
            onPress: () => confirm(`Bannir ${name} ${b.label} ?`, 'Bannir', () => serversApi.ban(sid, member.user_id, undefined, b.hours)),
          })),
          ...(can.banForever
            ? [{ label: 'Bannir définitivement', icon: 'ban' as const, danger: true, onPress: () => confirm(`Bannir ${name} définitivement ?`, 'Bannir', () => serversApi.ban(sid, member.user_id)) }]
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
          {timedOut ? <T variant="muted">Exclu jusqu’au {formatShort(member.timeout_until)}</T> : null}
        </View>
      </View>
      {can.roles && roles.length ? (
        <Section title="Rôles">
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
      {can.timeout ? (
        timedOut ? (
          <Button title="Lever l’exclusion temporaire" variant="secondary" icon="time-outline" loading={busy === 'untimeout'} onPress={() => void run('untimeout', () => serversApi.removeTimeout(sid, member.user_id))} />
        ) : (
          <Button title="Exclure temporairement" variant="secondary" icon="time-outline" loading={busy === 'timeout'} onPress={() => setSheet('timeout')} />
        )
      ) : null}
      {can.kick ? <Button title={`Expulser ${name}`} variant="danger" icon="exit-outline" onPress={() => confirm(`Expulser ${name} ?`, 'Expulser', () => serversApi.kick(sid, member.user_id))} /> : null}
      {can.ban ? <Button title={`Bannir ${name}`} variant="danger" icon="ban-outline" onPress={() => setSheet('ban')} /> : null}
      {!can.roles && !can.timeout && !can.kick && !can.ban ? <T variant="muted">Aucune action possible : ce membre a un rôle égal ou supérieur au tien.</T> : null}
      <Sheet visible={sheet !== null} onClose={() => setSheet(null)} title={sheet === 'timeout' ? 'Exclusion temporaire' : 'Bannissement'} actions={sheetActions} />
    </ScrollView>
  )
}
