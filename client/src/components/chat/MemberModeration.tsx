import { useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../api/client'
import { useVoice } from '../../store/voice'
import { useServerPerms, PERM } from '../../hooks/useServerPerms'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { confirm } from '../ui/ConfirmModal'
import type { ContextMenuEntry } from '../ui/ContextMenu'
import { buildModMenu } from '../userMenu/model'
import ChannelSettingsModal from '../modals/ChannelSettingsModal'
import { t as tr, intlLocale } from '../../i18n'

/**
 * Actions de modération sur un membre (audit P1-9 / P2-2) : rôles, modération
 * vocale, permissions du salon, expulser, bannir, timeout, notes de modération
 * (ordre et conditions : buildModMenu). Chaque action n'est
 * proposée que si l'utilisateur a la permission réelle ET est au-dessus du
 * membre dans la hiérarchie des rôles ; le serveur vérifie de nouveau.
 */

interface Member {
  user_id: string
  username: string
  nickname?: string | null
  is_owner?: boolean
  role_ids?: string[]
  timeout_until?: string | null
  voice_muted?: boolean
  voice_deafened?: boolean
}

type Dialog = { kind: 'ban' | 'timeout' | 'notes'; member: Member }

const errorOf = (e: any, fallback: string) => e?.response?.data?.error ?? fallback

const TIMEOUTS: Array<[string, number]> = [
  ['60 secondes', 1], ['5 minutes', 5], ['10 minutes', 10],
  ['1 heure', 60], ['1 jour', 1440], ['1 semaine', 10080],
]
const BANS: Array<[string, number | null]> = [
  ['Définitif', null], ['1 heure', 1], ['1 jour', 24], ['7 jours', 168], ['30 jours', 720],
]

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEscapeKey(onClose)
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label={title}
        className="relative bg-fc-channel border border-white/10 rounded-xl shadow-2xl p-5 w-full max-w-sm max-h-[85dvh] overflow-y-auto">
        <h3 className="text-white font-semibold mb-3">{title}</h3>
        {children}
      </div>
    </div>
  )
}

function SanctionDialog({ serverId, dialog, canBanForever, onClose, onDone }: {
  serverId: string; dialog: Dialog & { kind: 'ban' | 'timeout' }; canBanForever: boolean; onClose: () => void; onDone: () => void
}) {
  const { member, kind } = dialog
  const name = member.nickname ?? member.username
  // Sans « Bannir définitivement » (BAN_TEMP seul) : pas d'option définitive, durée obligatoire.
  const choices = kind === 'ban' ? (canBanForever ? BANS : BANS.filter(([, h]) => h !== null)) : TIMEOUTS
  const [choice, setChoice] = useState(0)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    const value = choices[choice][1]
    try {
      if (kind === 'ban') {
        await api.post(`/servers/${serverId}/members/${member.user_id}/ban`, {
          reason: reason.trim() || null,
          ...(value !== null ? { duration_hours: value } : {}),
        })
        toast.success(`${name} a été banni`)
      } else {
        await api.post(`/servers/${serverId}/members/${member.user_id}/timeout`, {
          duration_minutes: value,
          reason: reason.trim() || null,
        })
        toast.success(`${name} est en timeout (${choices[choice][0]})`)
      }
      onDone()
      onClose()
    } catch (e) {
      toast.error(errorOf(e, 'Action refusée'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell title={kind === 'ban' ? `Bannir ${name}` : `Timeout pour ${name}`} onClose={onClose}>
      <p className="text-xs text-fc-muted mb-2">
        {kind === 'ban'
          ? 'Le membre est retiré du serveur et ne peut plus le rejoindre pendant la durée choisie.'
          : 'Le membre peut lire et écouter, mais ne peut ni écrire, ni réagir, ni parler en vocal.'}
      </p>
      <label className="text-[11px] uppercase font-semibold text-fc-muted" htmlFor="mod-duration">Durée</label>
      <select id="mod-duration" value={choice} onChange={e => setChoice(Number(e.target.value))}
        className="w-full fc-input text-sm mt-1 mb-3">
        {choices.map(([label], i) => <option key={label} value={i}>{label}</option>)}
      </select>
      <label className="text-[11px] uppercase font-semibold text-fc-muted" htmlFor="mod-reason">Raison (facultatif)</label>
      <textarea id="mod-reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={512} rows={3}
        className="w-full fc-input text-sm mt-1 mb-4 resize-none" />
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 px-3 py-2 rounded-lg bg-fc-hover text-fc-text text-sm">Annuler</button>
        <button onClick={() => void submit()} disabled={busy}
          className="flex-1 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium disabled:opacity-50">
          {kind === 'ban' ? 'Bannir' : 'Appliquer'}
        </button>
      </div>
    </Shell>
  )
}

function NotesDialog({ serverId, member, onClose }: { serverId: string; member: Member; onClose: () => void }) {
  const qc = useQueryClient()
  const key = ['mod_notes', serverId, member.user_id]
  const { data: notes = [], isLoading } = useQuery<any[]>({
    queryKey: key,
    queryFn: () => api.get(`/servers/${serverId}/members/${member.user_id}/notes`).then(r => r.data),
  })
  const [text, setText] = useState('')
  const add = async () => {
    if (!text.trim()) return
    try {
      await api.post(`/servers/${serverId}/members/${member.user_id}/notes`, { note: text.trim() })
      setText('')
      void qc.invalidateQueries({ queryKey: key })
    } catch (e) {
      toast.error(errorOf(e, "Impossible d'ajouter la note"))
    }
  }
  const remove = async (id: string) => {
    try {
      await api.delete(`/servers/${serverId}/notes/${id}`)
      void qc.invalidateQueries({ queryKey: key })
    } catch (e) {
      toast.error(errorOf(e, 'Suppression refusée'))
    }
  }
  return (
    <Shell title={`Notes de modération : ${member.nickname ?? member.username}`} onClose={onClose}>
      <p className="text-xs text-fc-muted mb-2">Visibles des seuls modérateurs du serveur.</p>
      <div className="space-y-2 mb-3">
        {isLoading && <p className="text-xs text-fc-muted">Chargement…</p>}
        {!isLoading && notes.length === 0 && <p className="text-xs text-fc-muted">Aucune note.</p>}
        {notes.map((n: any) => (
          <div key={n.id} className="bg-fc-bg/60 rounded-lg px-3 py-2 text-sm text-fc-text flex gap-2">
            <div className="flex-1 min-w-0">
              <p className="whitespace-pre-wrap break-words">{n.note}</p>
              <p className="text-[10px] text-fc-muted mt-1">{new Date(n.created_at).toLocaleString(intlLocale())}</p>
            </div>
            <button onClick={() => void remove(n.id)} aria-label="Supprimer la note"
              className="self-start p-1 rounded text-fc-muted hover:text-red-400 hover:bg-fc-hover">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <textarea value={text} onChange={e => setText(e.target.value)} maxLength={2000} rows={3}
        placeholder="Nouvelle note…" aria-label="Nouvelle note" className="w-full fc-input text-sm resize-none mb-2" />
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 px-3 py-2 rounded-lg bg-fc-hover text-fc-text text-sm">Fermer</button>
        <button onClick={() => void add()} disabled={!text.trim()}
          className="flex-1 btn-primary text-sm py-2 disabled:opacity-50">Ajouter</button>
      </div>
    </Shell>
  )
}

type ModDialog = Dialog | { kind: 'perms'; member: Member; channelId: string }

export function useMemberModeration(serverId?: string) {
  const perms = useServerPerms(serverId)
  const qc = useQueryClient()
  const roomParticipants = useVoice(s => s.roomParticipants)
  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ['members', serverId],
    queryFn: () => api.get(`/servers/${serverId}/members`).then(r => r.data),
    enabled: !!serverId,
    staleTime: 30_000,
  })
  const [dialog, setDialog] = useState<ModDialog | null>(null)
  const byId = useMemo(() => new Map(members.map(m => [m.user_id, m])), [members])
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['members', serverId] }) }

  const voiceChannels = useMemo(
    () => perms.channels.filter(c => (c.type === 'voice' || c.type === 'video') && !c.is_auto_create),
    [perms.channels],
  )
  /** Salon vocal de ce serveur où se trouve le membre. */
  const voiceChannelOf = (userId: string): string | undefined =>
    perms.channels.find(c => (roomParticipants[c.id] ?? []).some(p => p.userId === userId))?.id

  const moderateVoice = (userId: string, body: object, done: string) => {
    api.patch(`/servers/${serverId}/members/${userId}/voice`, body)
      .then(() => { toast.success(done); refresh() })
      .catch(e => toast.error(errorOf(e, tr('mod.refused'))))
  }
  const call = (req: Promise<unknown>, done?: string) => {
    req.then(() => { if (done) toast.success(done); refresh() }).catch(e => toast.error(errorOf(e, tr('mod.refused'))))
  }

  /** Rôles, déplacer, permissions du salon, muet / sourdine imposés, déconnecter, expulser, bannir, timeout, notes. */
  const itemsFor = (userId: string): ContextMenuEntry[] => {
    const m = byId.get(userId)
    if (!serverId || !m) return []
    const name = m.nickname ?? m.username
    const current = voiceChannelOf(userId) ?? null
    const live = current ? (roomParticipants[current] ?? []).find(p => p.userId === userId) : undefined
    const muted = live?.serverMuted ?? m.voice_muted ?? false
    const deafened = live?.serverDeafened ?? m.voice_deafened ?? false
    const mine = new Set(m.role_ids ?? [])
    return buildModMenu({
      name,
      self: userId === perms.meId,
      above: perms.outranks(m),
      can: {
        roles: perms.has(PERM.MANAGE_ROLES),
        mute: perms.has(PERM.MUTE_MEMBERS),
        deafen: perms.has(PERM.DEAFEN_MEMBERS),
        move: perms.has(PERM.MOVE_MEMBERS),
        kick: perms.has(PERM.KICK_MEMBERS),
        ban: perms.has(PERM.BAN_MEMBERS | PERM.BAN_TEMP),
        timeout: perms.has(PERM.MANAGE_MESSAGES),
        notes: perms.has(PERM.MANAGE_MESSAGES),
        channelPerms: perms.canEditChannels,
      },
      timedOut: !!m.timeout_until && new Date(m.timeout_until) > new Date(),
      serverMuted: muted,
      serverDeafened: deafened,
      currentVoice: current,
      voiceChannels: voiceChannels.map(c => ({ id: String(c.id), name: String(c.name) })),
      roles: perms.assignableRoles.map(r => ({ id: r.id, name: r.name, has: mine.has(r.id) })),
    }, {
      role: (roleId, on) => call(on
        ? api.put(`/servers/${serverId}/members/${userId}/roles/${roleId}`)
        : api.delete(`/servers/${serverId}/members/${userId}/roles/${roleId}`)),
      moveTo: channelId => {
        const c = voiceChannels.find(x => x.id === channelId)
        moderateVoice(userId, { channel_id: channelId }, tr('mod.movedTo', { name: c?.name ?? '' }))
      },
      permissions: () => { if (current) setDialog({ kind: 'perms', member: m, channelId: current }) },
      serverMute: on => moderateVoice(userId, { mute: on }, on ? tr('mod.muted') : tr('mod.unmuted')),
      serverDeafen: on => moderateVoice(userId, { deafen: on }, on ? tr('mod.deafened') : tr('mod.undeafened')),
      disconnect: () => moderateVoice(userId, { disconnect: true }, tr('mod.disconnected')),
      kick: async () => {
        if (!(await confirm({ message: tr('mod.kickConfirm', { name }), danger: true, confirmLabel: tr('mod.kick') }))) return
        api.post(`/servers/${serverId}/members/${userId}/kick`)
          .then(() => { toast.success(tr('mod.kicked', { name })); refresh() })
          .catch(e => toast.error(errorOf(e, tr('mod.kickRefused'))))
      },
      ban: () => setDialog({ kind: 'ban', member: m }),
      timeout: () => setDialog({ kind: 'timeout', member: m }),
      liftTimeout: () => call(api.delete(`/servers/${serverId}/members/${userId}/timeout`), tr('mod.timeoutLifted')),
      notes: () => setDialog({ kind: 'notes', member: m }),
    }, tr)
  }

  const permsChannel = dialog?.kind === 'perms' ? perms.channels.find(c => c.id === dialog.channelId) : undefined
  const node = !serverId || !dialog ? null
    : dialog.kind === 'notes' ? <NotesDialog serverId={serverId} member={dialog.member} onClose={() => setDialog(null)} />
    : dialog.kind === 'perms' ? (permsChannel
      ? <ChannelSettingsModal channel={permsChannel} serverId={serverId} onClose={() => setDialog(null)} initialTab="permissions"
          initialTarget={{ id: dialog.member.user_id, name: dialog.member.nickname ?? dialog.member.username, type: 'member' }} />
      : null)
    : <SanctionDialog serverId={serverId} dialog={dialog as Dialog & { kind: 'ban' | 'timeout' }} canBanForever={perms.has(PERM.BAN_MEMBERS)} onClose={() => setDialog(null)} onDone={refresh} />

  return { itemsFor, node }
}
