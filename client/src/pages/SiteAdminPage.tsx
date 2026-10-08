import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Copy, Ban, LogOut, Trash2, Plus, Search, Crown } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { SERVER_URL } from '../api/client'
import { useMobile } from '../contexts/MobileContext'
import { useSiteAdmin, useSiteAdminInfo } from '../hooks/useSiteAdmin'

/** Administration du site : comptes, invitations, bannissements, réglages, journal. */

type Tab = 'overview' | 'users' | 'invites' | 'settings' | 'audit'
const TABS: [Tab, string][] = [['overview', 'Aperçu'], ['users', 'Comptes'], ['invites', 'Invitations'], ['settings', 'Réglages'], ['audit', 'Journal']]

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
  id: string; code: string; note: string | null; max_uses: number; uses: number
  status: 'active' | 'used' | 'expired' | 'revoked'; expires_at: string | null; created_at: string
  creator: string | null; used_by: { id: string; username: string; at: string }[]
}
interface AuditEntry { id: number; action: string; detail: Record<string, unknown> | null; created_at: string; admin: string | null; target: string | null }

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—')
const MODES: Record<Mode, string> = { invite: 'Sur invitation (code obligatoire)', closed: 'Fermées (personne ne peut s’inscrire)', open: 'Ouvertes à tous (déconseillé)' }
const ACTIONS: Record<string, string> = {
  grant_patron: 'a donné le rôle L-Patron à', revoke_patron: 'a retiré le rôle L-Patron à',
  ban: 'a banni', unban: 'a débanni', force_logout: 'a déconnecté', create_invite: 'a créé une invitation',
  revoke_invite: 'a révoqué une invitation',   set_registration_mode: 'a changé le mode d’inscription',
}
const inviteLink = (code: string) => `${SERVER_URL || window.location.origin}/register?code=${code}`

async function copy(text: string, ok: string) {
  try { await navigator.clipboard.writeText(text); toast.success(ok) } catch { toast.error('Copie impossible') }
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
  const { data } = useQuery<Overview>({ queryKey: ['site-admin', 'overview'], queryFn: () => api.get('/admin/overview').then(r => r.data), refetchInterval: 30_000 })
  if (!data) return <p className="text-fc-muted">Chargement…</p>
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Stat label="Comptes" value={data.total_users} />
      <Stat label="Connectés maintenant" value={data.online_now} />
      <Stat label="Actifs sur 24 h" value={data.active_24h} hint={`${data.active_7d} sur 7 jours`} />
      <Stat label="Nouveaux (7 jours)" value={data.new_7d} hint={`${data.new_24h} en 24 h · ${data.new_30d} en 30 j`} />
      <Stat label="Bannis" value={data.banned} />
      <Stat label="L-Patrons" value={data.patrons + 1} hint="propriétaire inclus" />
      <Stat label="Serveurs" value={data.servers} />
      <Stat label="Messages" value={data.messages.toLocaleString('fr-FR')} />
      <Stat label="Invitations actives" value={data.active_invites} />
      <Stat label="Inscriptions" value={data.registration_mode === 'invite' ? 'Sur invitation' : data.registration_mode === 'closed' ? 'Fermées' : 'Ouvertes'} />
    </div>
  )
}

function UserDetail({ id }: { id: string }) {
  const { data } = useQuery<{ sessions: { device: string | null; last_seen: string }[]; servers: { id: string; name: string; owner: boolean; joined_at: string }[]; invited: { id: string; username: string }[] }>({
    queryKey: ['site-admin', 'user', id], queryFn: () => api.get(`/admin/users/${id}`).then(r => r.data),
  })
  if (!data) return <p className="text-xs text-fc-muted p-3">Chargement…</p>
  return (
    <div className="grid md:grid-cols-3 gap-4 p-3 text-xs text-fc-muted bg-fc-bg/60">
      <div><div className="font-semibold text-white mb-1">Appareils ({data.sessions.length})</div>
        {data.sessions.length === 0 ? '—' : data.sessions.map((s, i) => <div key={i} className="truncate">{s.device ?? 'Appareil inconnu'} · {fmt(s.last_seen)}</div>)}</div>
      <div><div className="font-semibold text-white mb-1">Serveurs ({data.servers.length})</div>
        {data.servers.length === 0 ? '—' : data.servers.map(s => <div key={s.id} className="truncate">{s.name}{s.owner ? ' (propriétaire)' : ''} · depuis le {fmt(s.joined_at)}</div>)}</div>
      <div><div className="font-semibold text-white mb-1">A invité ({data.invited.length})</div>
        {data.invited.length === 0 ? '—' : data.invited.map(u => <div key={u.id}>{u.username}</div>)}</div>
    </div>
  )
}

function UsersTab() {
  const { owner } = useSiteAdminInfo()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [open, setOpen] = useState<string | null>(null)
  const { data, isLoading } = useQuery<{ total: number; users: AdminUser[] }>({
    queryKey: ['site-admin', 'users', q, filter],
    queryFn: () => api.get('/admin/users', { params: { q, filter, limit: 100 } }).then(r => r.data),
    placeholderData: prev => prev,
  })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['site-admin'] }) }
  const fail = (e: any) => toast.error(e?.response?.data?.error ?? 'Action impossible')
  const ban = useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/admin/users/${id}/ban`, { reason }), onSuccess: () => { toast.success('Compte banni'); refresh() }, onError: fail })
  const unban = useMutation({ mutationFn: (id: string) => api.delete(`/admin/users/${id}/ban`), onSuccess: () => { toast.success('Compte débanni'); refresh() }, onError: fail })
  const setPatron = useMutation({ mutationFn: ({ id, patron }: { id: string; patron: boolean }) => api.put(`/admin/users/${id}/patron`, { patron }), onSuccess: () => { toast.success('Rôle mis à jour'); refresh() }, onError: fail })
  const logout = useMutation({ mutationFn: (id: string) => api.post(`/admin/users/${id}/logout`), onSuccess: () => { toast.success('Appareils déconnectés'); refresh() }, onError: fail })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fc-muted" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Pseudo, e-mail ou identifiant…" className="w-full pl-8 pr-3 py-2 bg-fc-input rounded text-white text-sm outline-none focus:ring-2 focus:ring-fc-accent" />
        </div>
        <select value={filter} onChange={e => setFilter(e.target.value)} className="px-3 py-2 bg-fc-input rounded text-white text-sm outline-none">
          <option value="all">Tous</option><option value="online">Connectés</option><option value="recent">Récents (7 j)</option>
          <option value="banned">Bannis</option><option value="patrons">L-Patrons</option>
        </select>
        <span className="text-sm text-fc-muted">{data?.total ?? 0} compte(s)</span>
      </div>
      {isLoading && <p className="text-fc-muted">Chargement…</p>}
      <div className="rounded-lg border border-fc-hover overflow-hidden divide-y divide-fc-hover">
        {data?.users.map(u => (
          <div key={u.id}>
            <div className="flex flex-wrap items-center gap-3 px-3 py-2.5 bg-fc-channel hover:bg-fc-hover/40 cursor-pointer" onClick={() => setOpen(open === u.id ? null : u.id)}>
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${u.online ? 'bg-green-500' : 'bg-fc-muted/40'}`} title={u.online ? 'Connecté' : 'Hors ligne'} />
              <div className="min-w-0 flex-1 basis-48">
                <div className="text-white text-sm font-medium truncate">
                  {u.username}
                  {u.is_owner ? <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400">PROPRIÉTAIRE</span>
                    : u.is_patron && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-fc-accent/20 text-fc-accent">L-PATRON</span>}
                  {u.banned_at && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">BANNI</span>}
                  {u.is_bot && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-fc-hover text-fc-muted">BOT</span>}
                </div>
                <div className="text-xs text-fc-muted truncate">{u.email}</div>
              </div>
              <div className="text-xs text-fc-muted basis-44">
                <div>Inscrit le {fmt(u.created_at)}</div>
                <div>{u.invited_by ? `Invité par ${u.invited_by}` : 'Sans invitation'}{u.invite_note ? ` (« ${u.invite_note} »)` : ''}</div>
              </div>
              <div className="text-xs text-fc-muted basis-36">
                <div>Vu : {u.online ? 'en ligne' : fmt(u.last_seen)}</div>
                <div>{u.server_count} serveur(s) · {u.message_count} msg</div>
              </div>
              <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                {u.banned_at ? (
                  <button onClick={() => unban.mutate(u.id)} className="px-2 py-1 text-xs rounded bg-green-600/20 text-green-400 hover:bg-green-600/30">Débannir</button>
                ) : !u.is_patron && (
                  <button onClick={() => { const reason = window.prompt(`Bannir ${u.username} ? Motif (facultatif) :`); if (reason !== null) ban.mutate({ id: u.id, reason }) }}
                    className="p-1.5 rounded text-red-400 hover:bg-red-500/20" title="Bannir" aria-label={`Bannir ${u.username}`}><Ban size={15} /></button>
                )}
                {!u.is_bot && (
                  <button onClick={() => { if (window.confirm(`Déconnecter ${u.username} de tous ses appareils ?`)) logout.mutate(u.id) }}
                    className="p-1.5 rounded text-fc-muted hover:text-white hover:bg-fc-hover" title="Déconnecter partout" aria-label={`Déconnecter ${u.username}`}><LogOut size={15} /></button>
                )}
                {owner && !u.is_owner && !u.is_bot && !u.banned_at && (
                  <button onClick={() => { if (window.confirm(u.is_patron ? `Retirer le rôle L-Patron à ${u.username} ?` : `Donner le rôle L-Patron à ${u.username} ? Il aura accès à toute l’administration.`)) setPatron.mutate({ id: u.id, patron: !u.is_patron }) }}
                    className={`p-1.5 rounded hover:bg-fc-hover ${u.is_patron ? 'text-yellow-400' : 'text-fc-muted hover:text-white'}`} title={u.is_patron ? 'Retirer le rôle L-Patron' : 'Donner le rôle L-Patron'} aria-label="Rôle L-Patron"><Crown size={15} /></button>
                )}
              </div>
            </div>
            {u.banned_at && <div className="px-3 py-1.5 text-xs bg-red-500/10 text-red-300">Banni le {fmt(u.banned_at)}{u.ban_reason ? ` — ${u.ban_reason}` : ''}</div>}
            {open === u.id && <UserDetail id={u.id} />}
          </div>
        ))}
      </div>
    </div>
  )
}

function InvitesTab() {
  const qc = useQueryClient()
  const [note, setNote] = useState('')
  const [maxUses, setMaxUses] = useState(1)
  const [days, setDays] = useState(7)
  const { data } = useQuery<{ invites: Invite[] }>({ queryKey: ['site-admin', 'invites'], queryFn: () => api.get('/admin/invites').then(r => r.data) })
  const create = useMutation({
    mutationFn: () => api.post('/admin/invites', { note, max_uses: maxUses, expires_in_days: days || undefined }).then(r => r.data as { code: string }),
    onSuccess: r => { setNote(''); qc.invalidateQueries({ queryKey: ['site-admin'] }); void copy(inviteLink(r.code), 'Lien d’invitation copié — envoie-le à la personne') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Création impossible'),
  })
  const revoke = useMutation({ mutationFn: (id: string) => api.delete(`/admin/invites/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['site-admin'] }) })
  const STATUS = { active: ['Active', 'text-green-400'], used: ['Utilisée', 'text-fc-muted'], expired: ['Expirée', 'text-yellow-400'], revoked: ['Révoquée', 'text-red-400'] } as const

  return (
    <div className="space-y-4">
      <div className="bg-fc-channel border border-fc-hover rounded-lg p-4 space-y-3">
        <h2 className="text-white font-semibold">Nouvelle invitation</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-xs text-fc-muted flex-1 min-w-[180px]">Pour qui ? (note privée)
            <input value={note} onChange={e => setNote(e.target.value)} maxLength={100} placeholder="ex. Cousine Léa" className="mt-1 w-full px-3 py-2 bg-fc-input rounded text-white text-sm outline-none focus:ring-2 focus:ring-fc-accent" /></label>
          <label className="text-xs text-fc-muted">Utilisations
            <input type="number" min={1} max={1000} value={maxUses} onChange={e => setMaxUses(Math.max(1, Number(e.target.value) || 1))} className="mt-1 w-24 px-3 py-2 bg-fc-input rounded text-white text-sm outline-none" /></label>
          <label className="text-xs text-fc-muted">Valable (jours, 0 = illimité)
            <input type="number" min={0} max={365} value={days} onChange={e => setDays(Math.max(0, Number(e.target.value) || 0))} className="mt-1 w-24 px-3 py-2 bg-fc-input rounded text-white text-sm outline-none" /></label>
          <button onClick={() => create.mutate()} disabled={create.isPending} className="flex items-center gap-1.5 px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm disabled:opacity-50"><Plus size={14} /> Générer et copier le lien</button>
        </div>
      </div>
      <div className="rounded-lg border border-fc-hover overflow-hidden divide-y divide-fc-hover">
        {data?.invites.length === 0 && <p className="p-4 text-fc-muted text-sm">Aucune invitation pour le moment.</p>}
        {data?.invites.map(i => (
          <div key={i.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 bg-fc-channel">
            <code className="text-white font-mono tracking-wider text-sm">{i.code}</code>
            <span className={`text-xs ${STATUS[i.status][1]}`}>{STATUS[i.status][0]}</span>
            <span className="text-xs text-fc-muted">{i.uses}/{i.max_uses} utilisée(s)</span>
            <span className="text-xs text-fc-muted flex-1 min-w-[160px] truncate">{i.note ?? ''}{i.used_by.length ? ` → ${i.used_by.map(u => u.username).join(', ')}` : ''}</span>
            <span className="text-xs text-fc-muted">{i.expires_at ? `expire le ${fmt(i.expires_at)}` : 'sans expiration'}</span>
            <button onClick={() => copy(inviteLink(i.code.replace(/-/g, '')), 'Lien copié')} className="p-1.5 rounded text-fc-muted hover:text-white hover:bg-fc-hover" title="Copier le lien" aria-label="Copier le lien"><Copy size={15} /></button>
            <button onClick={() => copy(i.code, 'Code copié')} className="px-2 py-1 text-xs rounded text-fc-muted hover:text-white hover:bg-fc-hover">Code</button>
            {i.status === 'active' && <button onClick={() => { if (window.confirm('Révoquer cette invitation ?')) revoke.mutate(i.id) }} className="p-1.5 rounded text-red-400 hover:bg-red-500/20" title="Révoquer" aria-label="Révoquer"><Trash2 size={15} /></button>}
          </div>
        ))}
      </div>
    </div>
  )
}

function SettingsTab() {
  const qc = useQueryClient()
  const { data } = useQuery<{ registration_mode: Mode }>({ queryKey: ['site-admin', 'settings'], queryFn: () => api.get('/admin/settings').then(r => r.data) })
  const save = useMutation({
    mutationFn: (registration_mode: Mode) => api.put('/admin/settings', { registration_mode }),
    onSuccess: () => { toast.success('Réglage enregistré'); qc.invalidateQueries({ queryKey: ['site-admin'] }) },
    onError: () => toast.error('Enregistrement impossible'),
  })
  return (
    <div className="bg-fc-channel border border-fc-hover rounded-lg p-4 space-y-3 max-w-xl">
      <h2 className="text-white font-semibold">Qui peut créer un compte ?</h2>
      {(Object.keys(MODES) as Mode[]).map(m => (
        <label key={m} className="flex items-center gap-2 text-sm text-fc-text cursor-pointer">
          <input type="radio" name="mode" checked={data?.registration_mode === m} onChange={() => save.mutate(m)} className="accent-indigo-500" />
          {MODES[m]}
        </label>
      ))}
      <p className="text-xs text-fc-muted">Les comptes existants ne sont pas affectés. Un code d’invitation ne fonctionne qu’en mode « sur invitation ».</p>
    </div>
  )
}

function AuditTab() {
  const { data } = useQuery<{ entries: AuditEntry[] }>({ queryKey: ['site-admin', 'audit'], queryFn: () => api.get('/admin/audit').then(r => r.data) })
  return (
    <div className="rounded-lg border border-fc-hover overflow-hidden divide-y divide-fc-hover">
      {data?.entries.length === 0 && <p className="p-4 text-fc-muted text-sm">Aucune action enregistrée.</p>}
      {data?.entries.map(e => (
        <div key={e.id} className="px-3 py-2 bg-fc-channel text-sm text-fc-text flex flex-wrap gap-x-2">
          <span className="text-fc-muted w-36">{fmt(e.created_at)}</span>
          <span><b className="text-white">{e.admin ?? 'Administrateur supprimé'}</b> {ACTIONS[e.action] ?? e.action}{e.target ? <> <b className="text-white">{e.target}</b></> : null}
            {typeof e.detail?.reason === 'string' && e.detail.reason ? <span className="text-fc-muted"> — {e.detail.reason}</span> : null}
            {typeof e.detail?.mode === 'string' ? <span className="text-fc-muted"> → {e.detail.mode}</span> : null}</span>
        </div>
      ))}
    </div>
  )
}

export default function SiteAdminPage() {
  const nav = useNavigate()
  const { openSidebar } = useMobile()
  const isAdmin = useSiteAdmin()
  const [tab, setTab] = useState<Tab>('overview')
  // Compte non autorisé : on n'affiche rien (le serveur refuse de toute façon).
  if (!isAdmin) return <div className="flex-1 bg-fc-bg" />

  return (
    <div className="flex-1 overflow-y-auto overscroll-contain bg-fc-bg">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-fc-bg shadow-sm min-h-[48px] sticky top-0 bg-fc-bg z-10">
        <button className="md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-fc-hover text-fc-muted hover:text-white transition flex-shrink-0" onClick={openSidebar} aria-label="Ouvrir le menu"><ChevronLeft size={20} /></button>
        <h1 className="text-lg font-bold text-white truncate">Administration de ForgeChat</h1>
        <button onClick={() => nav(-1)} className="ml-auto text-fc-muted hover:text-white text-sm transition">← Retour</button>
      </div>
      <div className="max-w-5xl mx-auto p-4 space-y-4">
        <div role="tablist" className="flex flex-wrap gap-1 border-b border-fc-hover">
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={`px-4 py-2 text-sm -mb-px border-b-2 transition ${tab === id ? 'border-fc-accent text-white' : 'border-transparent text-fc-muted hover:text-white'}`}>{label}</button>
          ))}
        </div>
        {tab === 'overview' && <OverviewTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'invites' && <InvitesTab />}
        {tab === 'settings' && <SettingsTab />}
        {tab === 'audit' && <AuditTab />}
      </div>
    </div>
  )
}
