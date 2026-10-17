import { useState } from 'react'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Ban, LogOut, Trash2, Plus, Search, Crown } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { SERVER_URL } from '../api/client'
import { passwordProof } from '../e2e/accountKey'
import { useMobile } from '../contexts/MobileContext'
import { useSiteAdmin, useSiteAdminInfo } from '../hooks/useSiteAdmin'
import { HealthTab, SecurityTab } from '../components/admin/HealthTabs'
import { t as tr, useT, intlLocale, type Key } from '../i18n'
import { confirm } from '../components/ui/ConfirmModal'
import TextPromptDialog from '../components/ui/TextPromptDialog'

/** Administration du site : comptes, invitations, bannissements, réglages, journal. */

type Tab = 'overview' | 'health' | 'security' | 'users' | 'servers' | 'invites' | 'settings' | 'audit'
const TABS: Tab[] = ['overview', 'health', 'security', 'users', 'servers', 'invites', 'settings', 'audit']

interface Overview {
  total_users: number; online_now: number; new_24h: number; new_7d: number; new_30d: number
  banned: number; patrons: number; servers: number; messages: number; active_invites: number
  active_24h: number; active_7d: number; registration_mode: Mode
}
type Mode = 'open' | 'invite' | 'closed'
interface AdminUser {
  id: string; username: string; discriminator: string; email: string; created_at: string; is_bot: boolean
  is_owner: boolean; is_patron: boolean; banned_at: string | null; ban_reason: string | null
  invited_by: string | null; invite_note: string | null; last_seen: string | null; online: boolean
  server_count: number; message_count: number
}
interface Invite {
  /** Aperçu « ••••ABCD » : le code complet n'est montré (et copié) qu'à la création. */
  id: string; code: string; note: string | null; max_uses: number; uses: number
  status: 'active' | 'used' | 'expired' | 'revoked'; expires_at: string | null; created_at: string
  creator: string | null; used_by: { id: string; username: string; at: string }[]
}
interface AuditEntry { id: number; action: string; detail: Record<string, unknown> | null; created_at: string; admin: string | null; target: string | null }

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(intlLocale(), { dateStyle: 'short', timeStyle: 'short' }) : '—')
const MODES: Mode[] = ['invite', 'closed', 'open']
// Actions du journal : libellé sadm.a.<action> (i18n/parts/siteAdmin.ts), sinon le code brut.
const ACTIONS = new Set(['grant_patron', 'revoke_patron', 'ban', 'unban', 'force_logout', 'create_invite', 'revoke_invite',
  'set_registration_mode', 'supervise_server', 'end_supervision', 'suspend_server', 'unsuspend_server', 'delete_server'])
const inviteLink = (code: string) => `${SERVER_URL || window.location.origin}/register?code=${code}`

async function copy(text: string, ok: string) {
  try { await navigator.clipboard.writeText(text); toast.success(ok) } catch { toast.error(tr('sadm.copyFailed')) }
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="bg-fc-channel rounded-lg p-4 border border-fc-hover">
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-sm text-fc-muted">{label}</div>
      {hint && <div className="text-xs text-fc-muted/70 mt-0.5">{hint}</div>}
    </div>
  )
}

function OverviewTab() {
  const t = useT()
  const { data } = useQuery<Overview>({ queryKey: ['site-admin', 'overview'], queryFn: () => api.get('/admin/overview').then(r => r.data), refetchInterval: 30_000 })
  if (!data) return <p className="text-fc-muted">{t('common.loading')}</p>
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Stat label={t('sadm.st.accounts')} value={data.total_users} />
      <Stat label={t('sadm.st.onlineNow')} value={data.online_now} />
      <Stat label={t('sadm.st.active24')} value={data.active_24h} hint={t('sadm.st.active7', { n: data.active_7d })} />
      <Stat label={t('sadm.st.new7')} value={data.new_7d} hint={t('sadm.st.newHint', { d: data.new_24h, m: data.new_30d })} />
      <Stat label={t('sadm.st.banned')} value={data.banned} />
      <Stat label={t('sadm.st.patrons')} value={data.patrons + 1} hint={t('sadm.st.patronsHint')} />
      <Stat label={t('sadm.st.servers')} value={data.servers} />
      <Stat label={t('sadm.st.messages')} value={data.messages.toLocaleString(intlLocale())} />
      <Stat label={t('sadm.st.invites')} value={data.active_invites} />
      <Stat label={t('sadm.st.registrations')} value={t(`sadm.reg.${data.registration_mode}` as Key)} />
    </div>
  )
}

function UserDetail({ id }: { id: string }) {
  const t = useT()
  const { data } = useQuery<{ sessions: { device: string | null; last_seen: string }[]; servers: { id: string; name: string; owner: boolean; joined_at: string }[]; invited: { id: string; username: string }[] }>({
    queryKey: ['site-admin', 'user', id], queryFn: () => api.get(`/admin/users/${id}`).then(r => r.data),
  })
  if (!data) return <p className="text-xs text-fc-muted p-3">{t('common.loading')}</p>
  return (
    <div className="grid md:grid-cols-3 gap-4 p-3 text-xs text-fc-muted bg-fc-bg/60">
      <div><div className="font-semibold text-white mb-1">{t('sadm.devices', { n: data.sessions.length })}</div>
        {data.sessions.length === 0 ? '—' : data.sessions.map((s, i) => <div key={i} className="truncate">{s.device ?? t('sadm.unknownDevice')} · {fmt(s.last_seen)}</div>)}</div>
      <div><div className="font-semibold text-white mb-1">{t('sadm.serversN', { n: data.servers.length })}</div>
        {data.servers.length === 0 ? '—' : data.servers.map(s => <div key={s.id} className="truncate">{s.name}{s.owner ? t('sadm.ownerTag') : ''} · {t('sadm.since', { date: fmt(s.joined_at) })}</div>)}</div>
      <div><div className="font-semibold text-white mb-1">{t('sadm.invitedN', { n: data.invited.length })}</div>
        {data.invited.length === 0 ? '—' : data.invited.map(u => <div key={u.id}>{u.username}</div>)}</div>
    </div>
  )
}

function UsersTab() {
  const t = useT()
  const { owner } = useSiteAdminInfo()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [open, setOpen] = useState<string | null>(null)
  const [banning, setBanning] = useState<AdminUser | null>(null)
  const { data, isLoading } = useQuery<{ total: number; users: AdminUser[] }>({
    queryKey: ['site-admin', 'users', q, filter],
    queryFn: () => api.get('/admin/users', { params: { q, filter, limit: 100 } }).then(r => r.data),
    placeholderData: prev => prev,
  })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['site-admin'] }) }
  const fail = (e: any) => toast.error(e?.response?.data?.error ?? tr('sadm.actionFailed'))
  const ban = useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/admin/users/${id}/ban`, { reason }), onSuccess: () => { toast.success(tr('sadm.u.banned')); refresh() }, onError: fail })
  const unban = useMutation({ mutationFn: (id: string) => api.delete(`/admin/users/${id}/ban`), onSuccess: () => { toast.success(tr('sadm.u.unbanned')); refresh() }, onError: fail })
  const setPatron = useMutation({ mutationFn: ({ id, patron }: { id: string; patron: boolean }) => api.put(`/admin/users/${id}/patron`, { patron }), onSuccess: () => { toast.success(tr('sadm.u.roleUpdated')); refresh() }, onError: fail })
  const logout = useMutation({ mutationFn: (id: string) => api.post(`/admin/users/${id}/logout`), onSuccess: () => { toast.success(tr('sadm.u.loggedOut')); refresh() }, onError: fail })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fc-muted" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('sadm.u.search')} className="w-full pl-8 pr-3 py-2 bg-fc-input rounded text-white text-sm outline-none focus:ring-2 focus:ring-fc-accent" />
        </div>
        <select aria-label={t('sadm.filter')} value={filter} onChange={e => setFilter(e.target.value)} className="px-3 py-2 bg-fc-input rounded text-white text-sm outline-none">
          {(['all', 'online', 'recent', 'banned', 'patrons'] as const).map(f => <option key={f} value={f}>{t(`sadm.f.${f}`)}</option>)}
        </select>
        <span className="text-sm text-fc-muted">{t('sadm.u.count', { n: data?.total ?? 0 })}</span>
      </div>
      {isLoading && <p className="text-fc-muted">{t('common.loading')}</p>}
      <div className="rounded-lg border border-fc-hover overflow-hidden divide-y divide-fc-hover">
        {data?.users.map(u => (
          <div key={u.id}>
            <div className="flex flex-wrap items-center gap-3 px-3 py-2.5 bg-fc-channel hover:bg-fc-hover/40 cursor-pointer" onClick={() => setOpen(open === u.id ? null : u.id)}
              role="button" tabIndex={0} aria-expanded={open === u.id}
              onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(open === u.id ? null : u.id) } }}>
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${u.online ? 'bg-green-500' : 'bg-fc-muted/40'}`} title={t(u.online ? 'sadm.u.online' : 'sadm.u.offline')} />
              <div className="min-w-0 flex-1 basis-48">
                <div className="text-white text-sm font-medium truncate">
                  {u.username}
                  {u.is_owner ? <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400">{t('sadm.tag.owner')}</span>
                    : u.is_patron && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-fc-accent/20 text-fc-accent">{t('sadm.tag.patron')}</span>}
                  {u.banned_at && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">{t('sadm.tag.banned')}</span>}
                  {u.is_bot && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-fc-hover text-fc-muted">BOT</span>}
                </div>
                <div className="text-xs text-fc-muted truncate">{u.email}</div>
              </div>
              <div className="text-xs text-fc-muted basis-44">
                <div>{t('sadm.u.joined', { date: fmt(u.created_at) })}</div>
                <div>{u.invited_by ? t('sadm.u.invitedBy', { name: u.invited_by }) : t('sadm.u.noInvite')}{u.invite_note ? ` (« ${u.invite_note} »)` : ''}</div>
              </div>
              <div className="text-xs text-fc-muted basis-36">
                <div>{t('sadm.u.seen', { when: u.online ? t('sadm.u.onlineNow') : fmt(u.last_seen) })}</div>
                <div>{t('sadm.u.counts', { s: u.server_count, m: u.message_count })}</div>
              </div>
              <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                {u.banned_at ? (
                  <button onClick={() => unban.mutate(u.id)} className="px-2 py-1 text-xs rounded bg-green-600/20 text-green-400 hover:bg-green-600/30">{t('sadm.u.unban')}</button>
                ) : !u.is_patron && (
                  <button onClick={() => setBanning(u)}
                    className="p-1.5 rounded text-red-400 hover:bg-red-500/20" title={t('sadm.u.ban')} aria-label={t('sadm.u.banA11y', { name: u.username })}><Ban size={15} /></button>
                )}
                {!u.is_bot && (
                  <button onClick={() => { void confirm({ message: t('sadm.u.logoutConfirm', { name: u.username }), danger: true, confirmLabel: t('sadm.u.logoutAll') }).then(ok => { if (ok) logout.mutate(u.id) }) }}
                    className="p-1.5 rounded text-fc-muted hover:text-white hover:bg-fc-hover" title={t('sadm.u.logoutAll')} aria-label={t('sadm.u.logoutA11y', { name: u.username })}><LogOut size={15} /></button>
                )}
                {owner && !u.is_owner && !u.is_bot && !u.banned_at && (
                  <button onClick={() => { void confirm({ message: t(u.is_patron ? 'sadm.u.patronRevokeConfirm' : 'sadm.u.patronGrantConfirm', { name: u.username }), danger: true, confirmLabel: t(u.is_patron ? 'sadm.u.patronRevoke' : 'sadm.u.patronGrant') }).then(ok => { if (ok) setPatron.mutate({ id: u.id, patron: !u.is_patron }) }) }}
                    className={`p-1.5 rounded hover:bg-fc-hover ${u.is_patron ? 'text-yellow-400' : 'text-fc-muted hover:text-white'}`} title={t(u.is_patron ? 'sadm.u.patronRevoke' : 'sadm.u.patronGrant')} aria-label={t('sadm.u.patronA11y')}><Crown size={15} /></button>
                )}
              </div>
            </div>
            {u.banned_at && <div className="px-3 py-1.5 text-xs bg-red-500/10 text-red-300">{t('sadm.u.bannedOn', { date: fmt(u.banned_at) })}{u.ban_reason ? ` — ${u.ban_reason}` : ''}</div>}
            {open === u.id && <UserDetail id={u.id} />}
          </div>
        ))}
      </div>
      {banning && (
        <TextPromptDialog title={t('sadm.u.banTitle', { name: banning.username })} label={t('sadm.reasonOptional')} maxLength={300} allowEmpty
          submitLabel={t('sadm.u.ban')} danger
          onSubmit={reason => { ban.mutate({ id: banning.id, reason }); setBanning(null) }} onClose={() => setBanning(null)} />
      )}
    </div>
  )
}

interface AdminServer {
  id: string; name: string; is_public: boolean; created_at: string; owner: string | null
  members: number; channels: number; messages: number; storage_bytes: number
  suspended_at: string | null; suspended_reason: string | null; joined: boolean; supervising: boolean
  /** Ses bots peuvent publier dans « À la une » de tous les comptes. */
  news_public_allowed?: boolean
}
const sizeLabel = (n: number) => (n >= 1e9 ? tr('sadm.size.gb', { n: (n / 1e9).toFixed(1) }) : n >= 1e6 ? tr('sadm.size.mb', { n: (n / 1e6).toFixed(1) }) : tr('sadm.size.kb', { n: Math.round(n / 1e3) }))

/** Modération de l'instance : tous les serveurs, avec supervision visible, suspension et suppression. */
function ServersTab() {
  const t = useT()
  const qc = useQueryClient()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [del, setDel] = useState<AdminServer | null>(null)
  useEscapeKey(() => { setDel(null); setPw('') }, !!del)
  const [suspending, setSuspending] = useState<AdminServer | null>(null)
  const [pw, setPw] = useState('')
  const { data, isLoading } = useQuery<{ total: number; servers: AdminServer[] }>({
    queryKey: ['site-admin', 'servers', q, filter],
    queryFn: () => api.get('/admin/servers', { params: { q, filter, limit: 100 } }).then(r => r.data),
    placeholderData: prev => prev,
  })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['site-admin'] }); qc.invalidateQueries({ queryKey: ['servers'] }) }
  const fail = (e: any) => toast.error(e?.response?.data?.error ?? tr('sadm.actionFailed'))
  const supervise = useMutation({ mutationFn: (id: string) => api.post(`/admin/servers/${id}/supervise`), onSuccess: (_r, id) => { refresh(); nav(`/servers/${id}`) }, onError: fail })
  const endSup = useMutation({ mutationFn: (id: string) => api.delete(`/admin/servers/${id}/supervise`), onSuccess: () => { toast.success(tr('sadm.s.supEnded')); refresh() }, onError: fail })
  const suspend = useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/admin/servers/${id}/suspend`, { reason }), onSuccess: () => { toast.success(tr('sadm.s.suspended')); refresh() }, onError: fail })
  const newsPublic = useMutation({ mutationFn: ({ id, allowed }: { id: string; allowed: boolean }) => api.put(`/admin/servers/${id}/news-public`, { allowed }), onSuccess: (_, v) => { toast.success(tr(v.allowed ? 'sadm.s.newsOn' : 'sadm.s.newsOff')); refresh() }, onError: fail })
  const resume = useMutation({ mutationFn: (id: string) => api.delete(`/admin/servers/${id}/suspend`), onSuccess: () => { toast.success(tr('sadm.s.resumed')); refresh() }, onError: fail })
  const remove = useMutation({
    mutationFn: async ({ id, password }: { id: string; password: string }) => api.delete(`/admin/servers/${id}`, { data: await passwordProof(password) }),
    onSuccess: () => { toast.success(tr('sadm.s.deleted')); setDel(null); setPw(''); refresh() }, onError: fail,
  })

  return (
    <div className="space-y-3">
      <p className="text-xs text-fc-muted">{t('sadm.s.supInfo')}</p>
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fc-muted" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('sadm.s.search')} className="w-full pl-8 pr-3 py-2 bg-fc-input rounded text-white text-sm outline-none focus:ring-2 focus:ring-fc-accent" />
        </div>
        <select aria-label={t('sadm.filter')} value={filter} onChange={e => setFilter(e.target.value)} className="px-3 py-2 bg-fc-input rounded text-white text-sm outline-none">
          {(['all', 'public', 'suspended', 'supervised'] as const).map(f => <option key={f} value={f}>{t(`sadm.f.${f}`)}</option>)}
        </select>
        <span className="text-sm text-fc-muted">{t('sadm.s.count', { n: data?.total ?? 0 })}</span>
      </div>
      {isLoading && <p className="text-fc-muted">{t('common.loading')}</p>}
      <div className="rounded-lg border border-fc-hover overflow-hidden divide-y divide-fc-hover">
        {data?.servers.map(s => (
          <div key={s.id} className="bg-fc-channel">
            <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1 basis-48">
                <div className="text-white text-sm font-medium truncate">
                  {s.name}
                  {s.is_public && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-fc-hover text-fc-muted">{t('sadm.tag.public')}</span>}
                  {s.suspended_at && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">{t('sadm.tag.suspended')}</span>}
                  {s.supervising && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400">{t('sadm.tag.supervised')}</span>}
                </div>
                <div className="text-xs text-fc-muted truncate">{t('sadm.s.ownerLine', { owner: s.owner ?? '—', date: fmt(s.created_at) })}</div>
              </div>
              <div className="text-xs text-fc-muted basis-56">
                <div>{t('sadm.s.memberCounts', { m: s.members, c: s.channels })}</div>
                <div>{t('sadm.s.msgCounts', { m: s.messages.toLocaleString(intlLocale()), size: sizeLabel(s.storage_bytes) })}</div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {s.joined && !s.supervising ? (
                  <button onClick={() => nav(`/servers/${s.id}`)} className="px-2 py-1 text-xs rounded bg-fc-hover text-white hover:bg-fc-accent/30">{t('sadm.s.open')}</button>
                ) : (
                  <button onClick={() => supervise.mutate(s.id)} className="px-2 py-1 text-xs rounded bg-yellow-500/20 text-yellow-300 hover:bg-yellow-500/30">{t(s.supervising ? 'sadm.s.open' : 'sadm.s.supervise')}</button>
                )}
                {s.supervising && <button onClick={() => endSup.mutate(s.id)} className="px-2 py-1 text-xs rounded text-fc-muted hover:text-white hover:bg-fc-hover">{t('sadm.s.end')}</button>}
                <button onClick={() => newsPublic.mutate({ id: s.id, allowed: !s.news_public_allowed })} title={t('sadm.s.newsHint')}
                  className={`px-2 py-1 text-xs rounded ${s.news_public_allowed ? 'bg-fc-accent/20 text-fc-accent hover:bg-fc-accent/30' : 'text-fc-muted hover:text-white hover:bg-fc-hover'}`}>
                  {t(s.news_public_allowed ? 'sadm.s.newsRevoke' : 'sadm.s.newsAllow')}
                </button>
                {s.suspended_at
                  ? <button onClick={() => resume.mutate(s.id)} className="px-2 py-1 text-xs rounded bg-green-600/20 text-green-400 hover:bg-green-600/30">{t('sadm.s.resume')}</button>
                  : <button onClick={() => setSuspending(s)} className="px-2 py-1 text-xs rounded text-orange-300 hover:bg-orange-500/20">{t('sadm.s.suspend')}</button>}
                <button onClick={() => setDel(s)} className="p-1.5 rounded text-red-400 hover:bg-red-500/20" title={t('sadm.s.delete')} aria-label={t('sadm.s.deleteA11y', { name: s.name })}><Trash2 size={15} /></button>
              </div>
            </div>
            {s.suspended_at && <div className="px-3 py-1.5 text-xs bg-red-500/10 text-red-300">{t('sadm.s.suspendedOn', { date: fmt(s.suspended_at) })}{s.suspended_reason ? ` — ${s.suspended_reason}` : ''}</div>}
          </div>
        ))}
      </div>
      {suspending && (
        <TextPromptDialog title={t('sadm.s.suspendTitle', { name: suspending.name })} label={t('sadm.s.suspendReason')} maxLength={300} allowEmpty
          submitLabel={t('sadm.s.suspend')} danger
          onSubmit={reason => { suspend.mutate({ id: suspending.id, reason }); setSuspending(null) }} onClose={() => setSuspending(null)} />
      )}
      {del && (
        <div role="dialog" aria-modal="true" aria-label={t('sadm.s.delete')} className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 px-4">
          <form onSubmit={e => { e.preventDefault(); remove.mutate({ id: del.id, password: pw }) }} className="bg-fc-channel rounded-lg p-5 w-full max-w-sm space-y-3 border border-fc-hover">
            <h2 className="text-white font-semibold">{t('sadm.s.deleteTitle', { name: del.name })}</h2>
            <p className="text-sm text-fc-muted">{t('sadm.s.deleteWarn')}</p>
            <input type="password" autoFocus value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password" placeholder={t('sadm.s.password')} className="w-full px-3 py-2 bg-fc-input rounded text-white text-sm outline-none focus:ring-2 focus:ring-fc-accent" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setDel(null); setPw('') }} className="px-3 py-1.5 text-sm rounded text-fc-muted hover:text-white">{t('common.cancel')}</button>
              <button type="submit" disabled={!pw || remove.isPending} className="px-3 py-1.5 text-sm rounded bg-red-600 hover:bg-red-500 text-white disabled:opacity-50">{t('sadm.s.deleteForever')}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function InvitesTab() {
  const t = useT()
  const qc = useQueryClient()
  const [note, setNote] = useState('')
  const [maxUses, setMaxUses] = useState(1)
  const [days, setDays] = useState(7)
  const { data } = useQuery<{ invites: Invite[] }>({ queryKey: ['site-admin', 'invites'], queryFn: () => api.get('/admin/invites').then(r => r.data) })
  const create = useMutation({
    mutationFn: () => api.post('/admin/invites', { note, max_uses: maxUses, expires_in_days: days || undefined }).then(r => r.data as { code: string }),
    onSuccess: r => { setNote(''); qc.invalidateQueries({ queryKey: ['site-admin'] }); void copy(inviteLink(r.code), tr('sadm.i.linkCopied')) },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? tr('sadm.i.createFailed')),
  })
  const revoke = useMutation({ mutationFn: (id: string) => api.delete(`/admin/invites/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['site-admin'] }) })
  const STATUS = { active: 'text-green-400', used: 'text-fc-muted', expired: 'text-yellow-400', revoked: 'text-red-400' } as const

  return (
    <div className="space-y-4">
      <div className="bg-fc-channel border border-fc-hover rounded-lg p-4 space-y-3">
        <h2 className="text-white font-semibold">{t('sadm.i.new')}</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-xs text-fc-muted flex-1 min-w-[180px]">{t('sadm.i.forWho')}
            <input value={note} onChange={e => setNote(e.target.value)} maxLength={100} placeholder={t('sadm.i.forWhoPh')} className="mt-1 w-full px-3 py-2 bg-fc-input rounded text-white text-sm outline-none focus:ring-2 focus:ring-fc-accent" /></label>
          <label className="text-xs text-fc-muted">{t('sadm.i.uses')}
            <input type="number" min={1} max={1000} value={maxUses} onChange={e => setMaxUses(Math.max(1, Number(e.target.value) || 1))} className="mt-1 w-24 px-3 py-2 bg-fc-input rounded text-white text-sm outline-none" /></label>
          <label className="text-xs text-fc-muted">{t('sadm.i.days')}
            <input type="number" min={0} max={365} value={days} onChange={e => setDays(Math.max(0, Number(e.target.value) || 0))} className="mt-1 w-24 px-3 py-2 bg-fc-input rounded text-white text-sm outline-none" /></label>
          <button onClick={() => create.mutate()} disabled={create.isPending} className="flex items-center gap-1.5 px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm disabled:opacity-50"><Plus size={14} /> {t('sadm.i.generate')}</button>
        </div>
      </div>
      <div className="rounded-lg border border-fc-hover overflow-hidden divide-y divide-fc-hover">
        {data?.invites.length === 0 && <p className="p-4 text-fc-muted text-sm">{t('sadm.i.none')}</p>}
        {data?.invites.map(i => (
          <div key={i.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 bg-fc-channel">
            <code className="text-white font-mono tracking-wider text-sm">{i.code}</code>
            <span className={`text-xs ${STATUS[i.status]}`}>{t(`sadm.i.st.${i.status}`)}</span>
            <span className="text-xs text-fc-muted">{t('sadm.i.usedCount', { u: i.uses, m: i.max_uses })}</span>
            <span className="text-xs text-fc-muted flex-1 min-w-[160px] truncate">{i.note ?? ''}{i.used_by.length ? ` → ${i.used_by.map(u => u.username).join(', ')}` : ''}</span>
            <span className="text-xs text-fc-muted">{i.expires_at ? t('sadm.i.expiresOn', { date: fmt(i.expires_at) }) : t('sadm.i.noExpiry')}</span>
            {i.status === 'active' && <button onClick={() => { void confirm({ message: t('sadm.i.revokeConfirm'), danger: true, confirmLabel: t('sadm.i.revoke') }).then(ok => { if (ok) revoke.mutate(i.id) }) }} className="p-1.5 rounded text-red-400 hover:bg-red-500/20" title={t('sadm.i.revoke')} aria-label={t('sadm.i.revoke')}><Trash2 size={15} /></button>}
          </div>
        ))}
      </div>
    </div>
  )
}

function SettingsTab() {
  const t = useT()
  const qc = useQueryClient()
  const { data } = useQuery<{ registration_mode: Mode }>({ queryKey: ['site-admin', 'settings'], queryFn: () => api.get('/admin/settings').then(r => r.data) })
  const save = useMutation({
    mutationFn: (registration_mode: Mode) => api.put('/admin/settings', { registration_mode }),
    onSuccess: () => { toast.success(tr('sadm.set.saved')); qc.invalidateQueries({ queryKey: ['site-admin'] }) },
    onError: () => toast.error(tr('sadm.set.saveFailed')),
  })
  return (
    <div className="bg-fc-channel border border-fc-hover rounded-lg p-4 space-y-3 max-w-xl">
      <h2 className="text-white font-semibold">{t('sadm.set.who')}</h2>
      {MODES.map(m => (
        <label key={m} className="flex items-center gap-2 text-sm text-fc-text cursor-pointer">
          <input type="radio" name="mode" checked={data?.registration_mode === m} onChange={() => save.mutate(m)} className="accent-indigo-500" />
          {t(`sadm.mode.${m}`)}
        </label>
      ))}
      <p className="text-xs text-fc-muted">{t('sadm.set.hint')}</p>
    </div>
  )
}

function AuditTab() {
  const t = useT()
  const { data } = useQuery<{ entries: AuditEntry[] }>({ queryKey: ['site-admin', 'audit'], queryFn: () => api.get('/admin/audit').then(r => r.data) })
  return (
    <div className="rounded-lg border border-fc-hover overflow-hidden divide-y divide-fc-hover">
      {data?.entries.length === 0 && <p className="p-4 text-fc-muted text-sm">{t('sadm.a.none')}</p>}
      {data?.entries.map(e => (
        <div key={e.id} className="px-3 py-2 bg-fc-channel text-sm text-fc-text flex flex-wrap gap-x-2">
          <span className="text-fc-muted w-36">{fmt(e.created_at)}</span>
          <span><b className="text-white">{e.admin ?? t('sadm.a.deletedAdmin')}</b> {ACTIONS.has(e.action) ? t(`sadm.a.${e.action}` as Key) : e.action}{e.target ? <> <b className="text-white">{e.target}</b></> : null}
            {typeof e.detail?.server === 'string' ? <b className="text-white"> {e.detail.server}</b> : null}
            {typeof e.detail?.reason === 'string' && e.detail.reason ? <span className="text-fc-muted"> — {e.detail.reason}</span> : null}
            {typeof e.detail?.mode === 'string' ? <span className="text-fc-muted"> → {e.detail.mode}</span> : null}</span>
        </div>
      ))}
    </div>
  )
}

export default function SiteAdminPage() {
  const t = useT()
  const nav = useNavigate()
  const { openSidebar } = useMobile()
  const isAdmin = useSiteAdmin()
  const [tab, setTab] = useState<Tab>('overview')
  // Compte non autorisé : on n'affiche rien (le serveur refuse de toute façon).
  if (!isAdmin) return <div className="flex-1 bg-fc-bg" />

  return (
    <div className="flex-1 overflow-y-auto overscroll-contain bg-fc-bg">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-fc-bg shadow-sm min-h-[48px] sticky top-0 bg-fc-bg z-10">
        <button className="md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-fc-hover text-fc-muted hover:text-white transition flex-shrink-0" onClick={openSidebar} aria-label={t('sadm.openMenu')}><ChevronLeft size={20} /></button>
        <h1 className="text-lg font-bold text-white truncate">{t('sadm.title')}</h1>
        <button onClick={() => nav(-1)} className="ml-auto text-fc-muted hover:text-white text-sm transition">{t('sadm.back')}</button>
      </div>
      <div className="max-w-5xl mx-auto p-4 space-y-4">
        <div role="tablist" className="flex flex-wrap gap-1 border-b border-fc-hover">
          {TABS.map(id => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={`px-4 py-2 text-sm -mb-px border-b-2 transition ${tab === id ? 'border-fc-accent text-white' : 'border-transparent text-fc-muted hover:text-white'}`}>{t(`sadm.tab.${id}`)}</button>
          ))}
        </div>
        {tab === 'overview' && <OverviewTab />}
        {tab === 'health' && <HealthTab />}
        {tab === 'security' && <SecurityTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'servers' && <ServersTab />}
        {tab === 'invites' && <InvitesTab />}
        {tab === 'settings' && <SettingsTab />}
        {tab === 'audit' && <AuditTab />}
      </div>
    </div>
  )
}
