import { useMutation, useQuery } from '@tanstack/react-query'
import * as Clipboard from 'expo-clipboard'
import { useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import {
  adminApi,
  inviteLink,
  type AdminUser,
  type AuditEntry,
  type Invite,
  type RegistrationMode,
  type UserFilter,
} from '@/api/admin'
import { Button, EmptyState, ErrorState, Loading, Row, Section, TextField } from '@/components/ui'
import { apiOrigin } from '@/config/env'
import { errorMessage } from '@/lib/http'
import { queryClient } from '@/lib/queryClient'
import { colors, font, radius, spacing } from '@/theme'
import { useSiteAdmin } from './useSiteAdmin'

/** Administration du site (rôle El Patron) : aperçu, comptes, invitations, réglages, journal. */

type Tab = 'overview' | 'users' | 'invites' | 'settings' | 'audit'
const TABS: [Tab, string][] = [
  ['overview', 'Aperçu'],
  ['users', 'Comptes'],
  ['invites', 'Invitations'],
  ['settings', 'Réglages'],
  ['audit', 'Journal'],
]
const FILTERS: [UserFilter, string][] = [
  ['all', 'Tous'],
  ['online', 'Connectés'],
  ['recent', 'Récents'],
  ['banned', 'Bannis'],
  ['patrons', 'El Patron'],
]
const MODES: Record<RegistrationMode, string> = {
  invite: 'Sur invitation (code obligatoire)',
  closed: 'Fermées',
  open: 'Ouvertes à tous (déconseillé)',
}
const ACTIONS: Record<string, string> = {
  ban: 'a banni',
  unban: 'a débanni',
  force_logout: 'a déconnecté',
  create_invite: 'a créé une invitation',
  revoke_invite: 'a révoqué une invitation',
  grant_patron: 'a donné le rôle El Patron à',
  revoke_patron: 'a retiré le rôle El Patron à',
  set_registration_mode: 'a changé le mode d’inscription',
}
const STATUS: Record<Invite['status'], string> = { active: 'Active', used: 'Utilisée', expired: 'Expirée', revoked: 'Révoquée' }

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—')
const refresh = () => void queryClient.invalidateQueries({ queryKey: ['site-admin'] })
const fail = (e: unknown) => Alert.alert('Action impossible', errorMessage(e))

function OverviewTab() {
  const q = useQuery({ queryKey: ['site-admin', 'overview'], queryFn: adminApi.overview, refetchInterval: 30_000 })
  if (q.isLoading) return <Loading />
  if (q.error || !q.data) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
  const d = q.data
  const mode = d.registration_mode === 'invite' ? 'Sur invitation' : d.registration_mode === 'closed' ? 'Fermées' : 'Ouvertes'
  return (
    <Section>
      <Row icon="people-outline" title="Comptes" right={<Text style={styles.value}>{d.total_users}</Text>} />
      <Row icon="radio-button-on-outline" title="Connectés maintenant" right={<Text style={styles.value}>{d.online_now}</Text>} />
      <Row icon="pulse-outline" title="Actifs sur 24 h" subtitle={`${d.active_7d} sur 7 jours`} right={<Text style={styles.value}>{d.active_24h}</Text>} />
      <Row icon="person-add-outline" title="Nouveaux (7 jours)" subtitle={`${d.new_24h} en 24 h · ${d.new_30d} en 30 j`} right={<Text style={styles.value}>{d.new_7d}</Text>} />
      <Row icon="ban-outline" title="Bannis" right={<Text style={styles.value}>{d.banned}</Text>} />
      <Row icon="ribbon-outline" title="El Patron" subtitle="propriétaire inclus" right={<Text style={styles.value}>{d.patrons + 1}</Text>} />
      <Row icon="server-outline" title="Serveurs" right={<Text style={styles.value}>{d.servers}</Text>} />
      <Row icon="chatbubbles-outline" title="Messages" right={<Text style={styles.value}>{d.messages.toLocaleString('fr-FR')}</Text>} />
      <Row icon="ticket-outline" title="Invitations actives" right={<Text style={styles.value}>{d.active_invites}</Text>} />
      <Row icon="lock-closed-outline" title="Inscriptions" right={<Text style={styles.value}>{mode}</Text>} />
    </Section>
  )
}

function ReasonModal({ user, onClose, onConfirm }: { user: AdminUser | null; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('')
  return (
    <Modal visible={!!user} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.dialog}>
          <Text style={styles.dialogTitle}>Bannir {user?.username} ?</Text>
          <Text style={styles.muted}>Le compte est déconnecté partout et ne peut plus se reconnecter. Motif (facultatif) :</Text>
          <TextField label="Motif" value={reason} onChangeText={setReason} maxLength={300} />
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <Button title="Annuler" variant="secondary" style={{ flex: 1 }} onPress={() => { setReason(''); onClose() }} />
            <Button title="Bannir" variant="danger" style={{ flex: 1 }} onPress={() => { onConfirm(reason); setReason('') }} />
          </View>
        </View>
      </View>
    </Modal>
  )
}

function UsersTab() {
  const { owner } = useSiteAdmin()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<UserFilter>('all')
  const [banTarget, setBanTarget] = useState<AdminUser | null>(null)
  const list = useQuery({ queryKey: ['site-admin', 'users', q, filter], queryFn: () => adminApi.users(q, filter), placeholderData: (p) => p })
  const ban = useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => adminApi.ban(id, reason), onSuccess: refresh, onError: fail })
  const unban = useMutation({ mutationFn: adminApi.unban, onSuccess: refresh, onError: fail })
  const logout = useMutation({ mutationFn: adminApi.forceLogout, onSuccess: () => { refresh(); Alert.alert('Appareils déconnectés') }, onError: fail })
  const patron = useMutation({ mutationFn: ({ id, on }: { id: string; on: boolean }) => adminApi.setPatron(id, on), onSuccess: refresh, onError: fail })

  const actions = (u: AdminUser) => {
    const buttons: { text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }[] = []
    if (u.banned_at) buttons.push({ text: 'Débannir', onPress: () => unban.mutate(u.id) })
    else if (!u.is_patron) buttons.push({ text: 'Bannir…', style: 'destructive', onPress: () => setBanTarget(u) })
    if (!u.is_bot) buttons.push({ text: 'Déconnecter partout', onPress: () => logout.mutate(u.id) })
    if (owner && !u.is_owner && !u.is_bot && !u.banned_at) {
      buttons.push({
        text: u.is_patron ? 'Retirer le rôle El Patron' : 'Donner le rôle El Patron',
        onPress: () =>
          Alert.alert(
            u.is_patron ? 'Retirer le rôle ?' : 'Donner le rôle El Patron ?',
            u.is_patron ? u.username : `${u.username} aura accès à toute l’administration et tous les pouvoirs, partout.`,
            [{ text: 'Annuler', style: 'cancel' }, { text: 'Confirmer', onPress: () => patron.mutate({ id: u.id, on: !u.is_patron }) }],
          ),
      })
    }
    buttons.push({ text: 'Fermer', style: 'cancel' })
    Alert.alert(u.username, u.email, buttons)
  }

  return (
    <View style={{ gap: spacing.md }}>
      <TextField label="Rechercher" value={q} onChangeText={setQ} autoCapitalize="none" autoCorrect={false} placeholder="Pseudo, e-mail ou identifiant" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
        {FILTERS.map(([id, label]) => (
          <Pressable key={id} onPress={() => setFilter(id)} accessibilityRole="button" accessibilityState={{ selected: filter === id }} style={[styles.pill, filter === id && styles.pillOn]}>
            <Text style={[styles.pillText, filter === id && { color: '#fff' }]}>{label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {list.isLoading ? <Loading /> : list.error ? <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} /> : (
        <>
          <Text style={styles.muted}>{list.data?.total ?? 0} compte(s)</Text>
          <Section>
            {list.data?.users.map((u) => (
              <Row
                key={u.id}
                icon={u.online ? 'radio-button-on' : 'radio-button-off-outline'}
                title={`${u.username}${u.is_owner ? ' · PROPRIÉTAIRE' : u.is_patron ? ' · EL PATRON' : ''}${u.banned_at ? ' · BANNI' : ''}${u.is_bot ? ' · BOT' : ''}`}
                subtitle={`${u.email}\nInscrit le ${fmt(u.created_at)} · ${u.invited_by ? `invité par ${u.invited_by}${u.invite_note ? ` (« ${u.invite_note} »)` : ''}` : 'sans invitation'}\nVu : ${u.online ? 'en ligne' : fmt(u.last_seen)} · ${u.server_count} serveur(s) · ${u.message_count} msg${u.banned_at ? `\nBanni le ${fmt(u.banned_at)}${u.ban_reason ? ` — ${u.ban_reason}` : ''}` : ''}`}
                danger={!!u.banned_at}
                onPress={() => actions(u)}
                chevron
              />
            ))}
          </Section>
        </>
      )}
      <ReasonModal user={banTarget} onClose={() => setBanTarget(null)} onConfirm={(reason) => { if (banTarget) ban.mutate({ id: banTarget.id, reason }); setBanTarget(null) }} />
    </View>
  )
}

function InvitesTab() {
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
      Alert.alert('Invitation créée', `${r.code}\n\nLe lien est copié : envoie-le à la personne.`, [
        { text: 'Partager', onPress: () => void Share.share({ message: `Rejoins ForgeChat : ${link}` }) },
        { text: 'OK' },
      ])
    },
    onError: fail,
  })
  const revoke = useMutation({ mutationFn: adminApi.revokeInvite, onSuccess: refresh, onError: fail })

  return (
    <View style={{ gap: spacing.md }}>
      <Section title="Nouvelle invitation">
        <View style={{ padding: spacing.md, gap: spacing.md }}>
          <TextField label="Pour qui ? (note privée)" value={note} onChangeText={setNote} maxLength={100} placeholder="ex. Cousine Léa" />
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ flex: 1 }}><TextField label="Utilisations" value={uses} onChangeText={setUses} keyboardType="number-pad" /></View>
            <View style={{ flex: 1 }}><TextField label="Valable (jours, 0 = illimité)" value={days} onChangeText={setDays} keyboardType="number-pad" /></View>
          </View>
          <Button title="Générer et copier le lien" icon="add-circle-outline" onPress={() => create.mutate()} loading={create.isPending} />
        </View>
      </Section>
      {list.isLoading ? <Loading /> : list.error ? <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} /> : (
        <Section title="Invitations">
          {list.data?.invites.length === 0 ? <EmptyState icon="ticket-outline" title="Aucune invitation" /> : null}
          {list.data?.invites.map((i) => (
            <Row
              key={i.id}
              icon="ticket-outline"
              title={i.code}
              subtitle={`${STATUS[i.status]} · ${i.uses}/${i.max_uses}${i.note ? ` · ${i.note}` : ''}${i.used_by.length ? `\n→ ${i.used_by.map((u) => u.username).join(', ')}` : ''}\n${i.expires_at ? `expire le ${fmt(i.expires_at)}` : 'sans expiration'}`}
              onPress={() =>
                Alert.alert(i.code, STATUS[i.status], [
                  { text: 'Copier le lien', onPress: () => void Clipboard.setStringAsync(inviteLink(apiOrigin(), i.code)) },
                  { text: 'Partager', onPress: () => void Share.share({ message: `Rejoins ForgeChat : ${inviteLink(apiOrigin(), i.code)}` }) },
                  ...(i.status === 'active' ? [{ text: 'Révoquer', style: 'destructive' as const, onPress: () => revoke.mutate(i.id) }] : []),
                  { text: 'Fermer', style: 'cancel' as const },
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
  const q = useQuery({ queryKey: ['site-admin', 'overview'], queryFn: adminApi.overview })
  const save = useMutation({ mutationFn: adminApi.setMode, onSuccess: refresh, onError: fail })
  if (q.isLoading) return <Loading />
  return (
    <Section title="Qui peut créer un compte ?" footer="Les comptes existants ne sont pas affectés. Un code d’invitation ne fonctionne qu’en mode « sur invitation ».">
      {(Object.keys(MODES) as RegistrationMode[]).map((m) => (
        <Row key={m} title={MODES[m]} selected={q.data?.registration_mode === m} icon={q.data?.registration_mode === m ? 'radio-button-on' : 'radio-button-off-outline'} onPress={() => save.mutate(m)} />
      ))}
    </Section>
  )
}

function AuditTab() {
  const q = useQuery({ queryKey: ['site-admin', 'audit'], queryFn: adminApi.audit })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
  const entries: AuditEntry[] = q.data?.entries ?? []
  if (entries.length === 0) return <EmptyState icon="list-outline" title="Aucune action enregistrée" />
  return (
    <Section>
      {entries.map((e) => (
        <Row
          key={e.id}
          icon="time-outline"
          title={`${e.admin ?? 'Administrateur supprimé'} ${ACTIONS[e.action] ?? e.action}${e.target ? ` ${e.target}` : ''}`}
          subtitle={`${fmt(e.created_at)}${e.detail?.reason ? ` — ${e.detail.reason}` : ''}${e.detail?.mode ? ` → ${e.detail.mode}` : ''}`}
        />
      ))}
    </Section>
  )
}

export default function AdminScreen() {
  const { admin } = useSiteAdmin()
  const [tab, setTab] = useState<Tab>('overview')
  // Sans le rôle : rien à voir (le serveur refuse de toute façon).
  if (!admin) return <View style={{ flex: 1, backgroundColor: colors.bg }} />
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }} keyboardShouldPersistTaps="handled">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
        {TABS.map(([id, label]) => (
          <Pressable key={id} onPress={() => setTab(id)} accessibilityRole="tab" accessibilityState={{ selected: tab === id }} style={[styles.pill, tab === id && styles.pillOn]}>
            <Text style={[styles.pillText, tab === id && { color: '#fff' }]}>{label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {tab === 'overview' && <OverviewTab />}
      {tab === 'users' && <UsersTab />}
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
