import { useMutation, useQuery } from '@tanstack/react-query'
import * as Clipboard from 'expo-clipboard'
import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import {
  adminApi,
  inviteLink,
  type AdminServer,
  type AdminUser,
  type ServerFilter,
  type AuditEntry,
  type Invite,
  type RegistrationMode,
  type UserFilter,
} from '@/api/admin'
import { Button, EmptyState, ErrorState, Loading, Row, Section, TextField } from '@/components/ui'
import { apiOrigin } from '@/config/env'
import { dateLocale, t as tr, useT, type Key } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { queryClient } from '@/lib/queryClient'
import { colors, font, radius, spacing } from '@/theme'
import { useSiteAdmin } from './useSiteAdmin'

/** Administration du site (rôle El Patron) : aperçu, comptes, invitations, réglages, journal. */

type Tab = 'overview' | 'users' | 'servers' | 'invites' | 'settings' | 'audit'
const TABS: Tab[] = ['overview', 'users', 'servers', 'invites', 'settings', 'audit']
const FILTERS: UserFilter[] = ['all', 'online', 'recent', 'banned', 'patrons']
const MODES: RegistrationMode[] = ['invite', 'closed', 'open']
/** Actions connues du journal (libellé traduit) ; une action inconnue s'affiche telle quelle. */
const ACTIONS = new Set([
  'ban', 'unban', 'force_logout', 'create_invite', 'revoke_invite', 'grant_patron', 'revoke_patron',
  'set_registration_mode', 'supervise_server', 'end_supervision', 'suspend_server', 'unsuspend_server', 'delete_server',
])
const actionLabel = (a: string) => (ACTIONS.has(a) ? tr(`sadmin.action.${a}` as Key) : a)
const statusLabel = (s: Invite['status']) => tr(`sadmin.status.${s}` as Key)

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(dateLocale(), { dateStyle: 'short', timeStyle: 'short' }) : '—')
const num = (n: number) => n.toLocaleString(dateLocale())
const refresh = () => void queryClient.invalidateQueries({ queryKey: ['site-admin'] })
const fail = (e: unknown) => Alert.alert(tr('sadmin.failed'), errorMessage(e))

function OverviewTab() {
  const t = useT()
  const q = useQuery({ queryKey: ['site-admin', 'overview'], queryFn: adminApi.overview, refetchInterval: 30_000 })
  if (q.isLoading) return <Loading />
  if (q.error || !q.data) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
  const d = q.data
  const value = (n: number | string) => <Text style={styles.value}>{typeof n === 'number' ? num(n) : n}</Text>
  return (
    <Section>
      <Row icon="people-outline" title={t('sadmin.ov.accounts')} right={value(d.total_users)} />
      <Row icon="radio-button-on-outline" title={t('sadmin.ov.online')} right={value(d.online_now)} />
      <Row icon="pulse-outline" title={t('sadmin.ov.active24')} subtitle={t('sadmin.ov.active7', { n: d.active_7d })} right={value(d.active_24h)} />
      <Row icon="person-add-outline" title={t('sadmin.ov.new7')} subtitle={t('sadmin.ov.newSub', { d: d.new_24h, m: d.new_30d })} right={value(d.new_7d)} />
      <Row icon="ban-outline" title={t('sadmin.ov.banned')} right={value(d.banned)} />
      <Row icon="ribbon-outline" title={t('sadmin.ov.patrons')} subtitle={t('sadmin.ov.patronsSub')} right={value(d.patrons + 1)} />
      <Row icon="server-outline" title={t('sadmin.ov.servers')} right={value(d.servers)} />
      <Row icon="chatbubbles-outline" title={t('sadmin.ov.messages')} right={value(d.messages)} />
      <Row icon="ticket-outline" title={t('sadmin.ov.invites')} right={value(d.active_invites)} />
      <Row icon="lock-closed-outline" title={t('sadmin.ov.registration')} right={value(t(`sadmin.modeShort.${d.registration_mode}`))} />
    </Section>
  )
}

/** Boîte de saisie (motif, mot de passe) : Alert.prompt n'existe pas sur Android. */
function PromptModal({
  visible,
  title,
  message,
  label,
  confirmLabel,
  secure,
  onClose,
  onConfirm,
}: {
  visible: boolean
  title: string
  message: string
  label: string
  confirmLabel: string
  secure?: boolean
  onClose: () => void
  onConfirm: (value: string) => void
}) {
  const t = useT()
  const [value, setValue] = useState('')
  const close = () => {
    setValue('')
    onClose()
  }
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.dialog}>
          <Text style={styles.dialogTitle}>{title}</Text>
          <Text style={styles.muted}>{message}</Text>
          <TextField label={label} value={value} onChangeText={setValue} maxLength={300} secureTextEntry={secure} autoCapitalize="none" autoCorrect={false} />
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <Button title={t('common.cancel')} variant="secondary" style={{ flex: 1 }} onPress={close} />
            <Button
              title={confirmLabel}
              variant="danger"
              style={{ flex: 1 }}
              onPress={() => {
                onConfirm(value)
                setValue('')
              }}
            />
          </View>
        </View>
      </View>
    </Modal>
  )
}

/** Pastilles de filtre défilantes. */
function Pills<T extends string>({ items, value, onChange, label, role = 'button' }: { items: readonly T[]; value: T; onChange: (v: T) => void; label: (v: T) => string; role?: 'button' | 'tab' }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
      {items.map((id) => (
        <Pressable key={id} onPress={() => onChange(id)} accessibilityRole={role} accessibilityState={{ selected: value === id }} style={[styles.pill, value === id && styles.pillOn]}>
          <Text style={[styles.pillText, value === id && { color: '#fff' }]}>{label(id)}</Text>
        </Pressable>
      ))}
    </ScrollView>
  )
}

function UsersTab() {
  const t = useT()
  const { owner } = useSiteAdmin()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<UserFilter>('all')
  const [banTarget, setBanTarget] = useState<AdminUser | null>(null)
  const list = useQuery({ queryKey: ['site-admin', 'users', q, filter], queryFn: () => adminApi.users(q, filter), placeholderData: (p) => p })
  const ban = useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => adminApi.ban(id, reason), onSuccess: refresh, onError: fail })
  const unban = useMutation({ mutationFn: adminApi.unban, onSuccess: refresh, onError: fail })
  const logout = useMutation({ mutationFn: adminApi.forceLogout, onSuccess: () => { refresh(); Alert.alert(t('sadmin.loggedOut')) }, onError: fail })
  const patron = useMutation({ mutationFn: ({ id, on }: { id: string; on: boolean }) => adminApi.setPatron(id, on), onSuccess: refresh, onError: fail })

  const actions = (u: AdminUser) => {
    const buttons: { text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }[] = []
    if (u.banned_at) buttons.push({ text: t('sadmin.u.unban'), onPress: () => unban.mutate(u.id) })
    else if (!u.is_patron) buttons.push({ text: t('sadmin.u.ban'), style: 'destructive', onPress: () => setBanTarget(u) })
    if (!u.is_bot) buttons.push({ text: t('sadmin.u.logout'), onPress: () => logout.mutate(u.id) })
    if (owner && !u.is_owner && !u.is_bot && !u.banned_at) {
      buttons.push({
        text: u.is_patron ? t('sadmin.u.revokePatron') : t('sadmin.u.grantPatron'),
        onPress: () =>
          Alert.alert(
            u.is_patron ? t('sadmin.u.revokeTitle') : t('sadmin.u.grantTitle'),
            u.is_patron ? u.username : t('sadmin.u.grantBody', { name: u.username }),
            [{ text: t('common.cancel'), style: 'cancel' }, { text: t('common.confirm'), onPress: () => patron.mutate({ id: u.id, on: !u.is_patron }) }],
          ),
      })
    }
    buttons.push({ text: t('common.close'), style: 'cancel' })
    Alert.alert(u.username, u.email, buttons)
  }

  const title = (u: AdminUser) =>
    [u.username, u.is_owner ? t('sadmin.u.owner') : u.is_patron ? t('sadmin.u.patron') : '', u.banned_at ? t('sadmin.u.bannedTag') : '', u.is_bot ? t('sadmin.u.bot') : '']
      .filter(Boolean)
      .join(' · ')
  const subtitle = (u: AdminUser) => {
    const invited = u.invited_by ? `${t('sadmin.u.invitedBy', { name: u.invited_by })}${u.invite_note ? ` (« ${u.invite_note} »)` : ''}` : t('sadmin.u.noInvite')
    const lines = [
      u.email,
      `${t('sadmin.u.joined', { date: fmt(u.created_at) })} · ${invited}`,
      `${t('sadmin.u.seen', { when: u.online ? t('sadmin.u.onlineNow') : fmt(u.last_seen) })} · ${t('sadmin.u.stats', { servers: u.server_count, messages: u.message_count })}`,
    ]
    if (u.banned_at) lines.push(`${t('sadmin.u.bannedOn', { date: fmt(u.banned_at) })}${u.ban_reason ? ` — ${u.ban_reason}` : ''}`)
    return lines.join('\n')
  }

  return (
    <View style={{ gap: spacing.md }}>
      <TextField label={t('sadmin.search')} value={q} onChangeText={setQ} autoCapitalize="none" autoCorrect={false} placeholder={t('sadmin.u.searchPh')} />
      <Pills items={FILTERS} value={filter} onChange={setFilter} label={(f) => t(`sadmin.filter.${f}`)} />
      {list.isLoading ? <Loading /> : list.error ? <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} /> : (
        <>
          <Text style={styles.muted}>{t('sadmin.u.count', { n: list.data?.total ?? 0 })}</Text>
          <Section>
            {list.data?.users.map((u) => (
              <Row
                key={u.id}
                icon={u.online ? 'radio-button-on' : 'radio-button-off-outline'}
                title={title(u)}
                subtitle={subtitle(u)}
                danger={!!u.banned_at}
                onPress={() => actions(u)}
                chevron
              />
            ))}
          </Section>
        </>
      )}
      <PromptModal
        visible={!!banTarget}
        title={t('sadmin.u.banTitle', { name: banTarget?.username ?? '' })}
        message={t('sadmin.u.banBody')}
        label={t('sadmin.reason')}
        confirmLabel={t('sadmin.u.banConfirm')}
        onClose={() => setBanTarget(null)}
        onConfirm={(reason) => {
          if (banTarget) ban.mutate({ id: banTarget.id, reason })
          setBanTarget(null)
        }}
      />
    </View>
  )
}

const SERVER_FILTERS: ServerFilter[] = ['all', 'public', 'suspended', 'supervised']
const sizeLabel = (n: number) =>
  n >= 1e9 ? tr('sadmin.size.gb', { n: (n / 1e9).toFixed(1) }) : n >= 1e6 ? tr('sadmin.size.mb', { n: (n / 1e6).toFixed(1) }) : tr('sadmin.size.kb', { n: Math.round(n / 1e3) })

/** Modération de l'instance : supervision visible, suspension, suppression. */
function ServersTab() {
  const t = useT()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<ServerFilter>('all')
  const [suspendTarget, setSuspendTarget] = useState<AdminServer | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminServer | null>(null)
  const list = useQuery({ queryKey: ['site-admin', 'servers', q, filter], queryFn: () => adminApi.servers(q, filter), placeholderData: (p) => p })
  const done = () => {
    refresh()
    void queryClient.invalidateQueries({ queryKey: ['servers'] })
  }
  const supervise = useMutation({ mutationFn: adminApi.supervise, onSuccess: (_r, id) => { done(); router.push(`/server/${id}`) }, onError: fail })
  const endSup = useMutation({ mutationFn: adminApi.endSupervision, onSuccess: done, onError: fail })
  const suspend = useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => adminApi.suspend(id, reason), onSuccess: done, onError: fail })
  const resume = useMutation({ mutationFn: adminApi.unsuspend, onSuccess: done, onError: fail })
  const remove = useMutation({ mutationFn: ({ id, password }: { id: string; password: string }) => adminApi.deleteServer(id, password), onSuccess: done, onError: fail })

  const actions = (s: AdminServer) => {
    const buttons: { text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }[] = []
    if (s.joined && !s.supervising) buttons.push({ text: t('sadmin.s.open'), onPress: () => router.push(`/server/${s.id}`) })
    else buttons.push({ text: s.supervising ? t('sadmin.s.openSupervised') : t('sadmin.s.supervise'), onPress: () => (s.supervising ? router.push(`/server/${s.id}`) : supervise.mutate(s.id)) })
    if (s.supervising) buttons.push({ text: t('sadmin.s.endSupervision'), onPress: () => endSup.mutate(s.id) })
    if (s.suspended_at) buttons.push({ text: t('sadmin.s.resume'), onPress: () => resume.mutate(s.id) })
    else buttons.push({ text: t('sadmin.s.suspend'), onPress: () => setSuspendTarget(s) })
    buttons.push({ text: t('sadmin.s.delete'), style: 'destructive', onPress: () => setDeleteTarget(s) })
    buttons.push({ text: t('common.close'), style: 'cancel' })
    Alert.alert(s.name, t('sadmin.s.summary', { n: s.members, owner: s.owner ?? '—' }), buttons)
  }

  const title = (s: AdminServer) =>
    [s.name, s.is_public ? t('sadmin.s.publicTag') : '', s.suspended_at ? t('sadmin.s.suspendedTag') : '', s.supervising ? t('sadmin.s.supervisedTag') : ''].filter(Boolean).join(' · ')
  const subtitle = (s: AdminServer) => {
    const lines = [
      t('sadmin.s.ownerLine', { owner: s.owner ?? '—', date: fmt(s.created_at) }),
      t('sadmin.s.stats', { members: s.members, channels: s.channels, messages: num(s.messages), size: sizeLabel(s.storage_bytes) }),
    ]
    if (s.suspended_at) lines.push(`${t('sadmin.s.suspendedOn', { date: fmt(s.suspended_at) })}${s.suspended_reason ? ` — ${s.suspended_reason}` : ''}`)
    return lines.join('\n')
  }

  return (
    <View style={{ gap: spacing.md }}>
      <Text style={styles.muted}>{t('sadmin.s.intro')}</Text>
      <TextField label={t('sadmin.search')} value={q} onChangeText={setQ} autoCapitalize="none" autoCorrect={false} placeholder={t('sadmin.s.searchPh')} />
      <Pills items={SERVER_FILTERS} value={filter} onChange={setFilter} label={(f) => t(`sadmin.filter.${f}`)} />
      {list.isLoading ? <Loading /> : list.error ? <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} /> : (
        <>
          <Text style={styles.muted}>{t('sadmin.s.count', { n: list.data?.total ?? 0 })}</Text>
          <Section>
            {list.data?.servers.map((s) => (
              <Row
                key={s.id}
                icon={s.suspended_at ? 'pause-circle-outline' : s.supervising ? 'eye-outline' : 'server-outline'}
                title={title(s)}
                subtitle={subtitle(s)}
                danger={!!s.suspended_at}
                onPress={() => actions(s)}
                chevron
              />
            ))}
          </Section>
        </>
      )}
      <PromptModal
        visible={!!suspendTarget}
        title={t('sadmin.s.suspendTitle', { name: suspendTarget?.name ?? '' })}
        message={t('sadmin.s.suspendBody')}
        label={t('sadmin.reason')}
        confirmLabel={t('sadmin.s.suspendConfirm')}
        onClose={() => setSuspendTarget(null)}
        onConfirm={(reason) => {
          if (suspendTarget) suspend.mutate({ id: suspendTarget.id, reason })
          setSuspendTarget(null)
        }}
      />
      <PromptModal
        visible={!!deleteTarget}
        title={t('sadmin.s.deleteTitle', { name: deleteTarget?.name ?? '' })}
        message={t('sadmin.s.deleteBody')}
        label={t('sadmin.s.password')}
        confirmLabel={t('sadmin.s.deleteConfirm')}
        secure
        onClose={() => setDeleteTarget(null)}
        onConfirm={(password) => {
          if (deleteTarget && password) remove.mutate({ id: deleteTarget.id, password })
          setDeleteTarget(null)
        }}
      />
    </View>
  )
}

function InvitesTab() {
  const t = useT()
  const [note, setNote] = useState('')
  const [uses, setUses] = useState('1')
  const [days, setDays] = useState('7')
  const list = useQuery({ queryKey: ['site-admin', 'invites'], queryFn: adminApi.invites })
  const create = useMutation({
    mutationFn: () => adminApi.createInvite(note, Math.max(1, Number(uses) || 1), Math.max(0, Number(days) || 0)),
    onSuccess: async (r) => {
      setNote('')
      refresh()
      const link = inviteLink(apiOrigin(), r.code)
      await Clipboard.setStringAsync(link)
      Alert.alert(t('sadmin.i.created'), t('sadmin.i.createdBody', { code: r.code }), [
        { text: t('sadmin.i.share'), onPress: () => void Share.share({ message: t('sadmin.i.shareMessage', { link }) }) },
        { text: 'OK' },
      ])
    },
    onError: fail,
  })
  const revoke = useMutation({ mutationFn: adminApi.revokeInvite, onSuccess: refresh, onError: fail })

  return (
    <View style={{ gap: spacing.md }}>
      <Section title={t('sadmin.i.new')}>
        <View style={{ padding: spacing.md, gap: spacing.md }}>
          <TextField label={t('sadmin.i.note')} value={note} onChangeText={setNote} maxLength={100} placeholder={t('sadmin.i.notePh')} />
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ flex: 1 }}><TextField label={t('sadmin.i.uses')} value={uses} onChangeText={setUses} keyboardType="number-pad" /></View>
            <View style={{ flex: 1 }}><TextField label={t('sadmin.i.days')} value={days} onChangeText={setDays} keyboardType="number-pad" /></View>
          </View>
          <Button title={t('sadmin.i.generate')} icon="add-circle-outline" onPress={() => create.mutate()} loading={create.isPending} />
        </View>
      </Section>
      {list.isLoading ? <Loading /> : list.error ? <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} /> : (
        <Section title={t('sadmin.i.list')}>
          {list.data?.invites.length === 0 ? <EmptyState icon="ticket-outline" title={t('sadmin.i.empty')} /> : null}
          {list.data?.invites.map((i) => (
            <Row
              key={i.id}
              icon="ticket-outline"
              title={i.code}
              subtitle={`${statusLabel(i.status)} · ${i.uses}/${i.max_uses}${i.note ? ` · ${i.note}` : ''}${i.used_by.length ? `\n→ ${i.used_by.map((u) => u.username).join(', ')}` : ''}\n${i.expires_at ? t('sadmin.i.expires', { date: fmt(i.expires_at) }) : t('sadmin.i.noExpiry')}`}
              onPress={() =>
                Alert.alert(i.code, statusLabel(i.status), [
                  ...(i.status === 'active' ? [{ text: t('sadmin.i.revoke'), style: 'destructive' as const, onPress: () => revoke.mutate(i.id) }] : []),
                  { text: t('common.close'), style: 'cancel' as const },
                ])
              }
              chevron
            />
          ))}
        </Section>
      )}
    </View>
  )
}

function SettingsTab() {
  const t = useT()
  const q = useQuery({ queryKey: ['site-admin', 'overview'], queryFn: adminApi.overview })
  const save = useMutation({ mutationFn: adminApi.setMode, onSuccess: refresh, onError: fail })
  if (q.isLoading) return <Loading />
  return (
    <Section title={t('sadmin.settings.title')} footer={t('sadmin.settings.footer')}>
      {MODES.map((m) => (
        <Row key={m} title={t(`sadmin.mode.${m}`)} selected={q.data?.registration_mode === m} icon={q.data?.registration_mode === m ? 'radio-button-on' : 'radio-button-off-outline'} onPress={() => save.mutate(m)} />
      ))}
    </Section>
  )
}

function AuditTab() {
  const t = useT()
  const q = useQuery({ queryKey: ['site-admin', 'audit'], queryFn: adminApi.audit })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
  const entries: AuditEntry[] = q.data?.entries ?? []
  if (entries.length === 0) return <EmptyState icon="list-outline" title={t('sadmin.audit.empty')} />
  return (
    <Section>
      {entries.map((e) => (
        <Row
          key={e.id}
          icon="time-outline"
          title={`${e.admin ?? t('sadmin.audit.deletedAdmin')} ${actionLabel(e.action)}${e.target ? ` ${e.target}` : ''}${e.detail?.server ? ` ${e.detail.server}` : ''}`}
          subtitle={`${fmt(e.created_at)}${e.detail?.reason ? ` — ${e.detail.reason}` : ''}${e.detail?.mode ? ` → ${e.detail.mode}` : ''}`}
        />
      ))}
    </Section>
  )
}

export default function AdminScreen() {
  const t = useT()
  const { admin } = useSiteAdmin()
  const [tab, setTab] = useState<Tab>('overview')
  // Sans le rôle : rien à voir (le serveur refuse de toute façon).
  if (!admin) return <View style={{ flex: 1, backgroundColor: colors.bg }} />
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }} keyboardShouldPersistTaps="handled">
      <Pills items={TABS} value={tab} onChange={setTab} label={(id) => t(`sadmin.tab.${id}`)} role="tab" />
      {tab === 'overview' && <OverviewTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'servers' && <ServersTab />}
      {tab === 'invites' && <InvitesTab />}
      {tab === 'settings' && <SettingsTab />}
      {tab === 'audit' && <AuditTab />}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  value: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  muted: { color: colors.textMuted, fontSize: font.sm },
  pill: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.full, backgroundColor: colors.bgElevated },
  pillOn: { backgroundColor: colors.primary },
  pillText: { color: colors.text, fontSize: font.md },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: spacing.xl },
  dialog: { backgroundColor: colors.bgElevated, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md },
  dialogTitle: { color: colors.text, fontSize: font.lg, fontWeight: '700' },
})
