import { useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../api/client'
import { fetchAllMembers } from '../../api/members'
import { useVoice } from '../../store/voice'
import { useServerPerms, PERM } from '../../hooks/useServerPerms'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { confirm } from '../ui/ConfirmModal'
import type { ContextMenuEntry } from '../ui/ContextMenu'
import { buildModMenu, canRenameMember } from '../userMenu/model'
import ChannelSettingsModal from '../modals/ChannelSettingsModal'
import { t as tr, intlLocale, type Key } from '../../i18n'

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

type Dialog = { kind: 'ban' | 'timeout' | 'notes' | 'nick'; member: Member }

const errorOf = (e: any, fallback: string) => e?.response?.data?.error ?? fallback

const TIMEOUTS: Array<[Key, number]> = [
  ['modx.d.60s', 1], ['modx.d.5m', 5], ['modx.d.10m', 10],
  ['modx.d.1h', 60], ['modx.d.1d', 1440], ['modx.d.1w', 10080],
]
const BANS: Array<[Key, number | null]> = [
  ['modx.d.forever', null], ['modx.d.1h', 1], ['modx.d.1d', 24], ['modx.d.7d', 168], ['modx.d.30d', 720],
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
        toast.success(tr('modx.banned', { name }))
      } else {
        await api.post(`/servers/${serverId}/members/${member.user_id}/timeout`, {
          duration_minutes: value,
          reason: reason.trim() || null,
        })
        toast.success(tr('modx.timedOut', { name, d: tr(choices[choice][0]) }))
      }
      onDone()
      onClose()
    } catch (e) {
      toast.error(errorOf(e, tr('mod.refused')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell title={tr(kind === 'ban' ? 'modx.banTitle' : 'modx.timeoutTitle', { name })} onClose={onClose}>
      <p className="text-xs text-fc-muted mb-2">
        {tr(kind === 'ban' ? 'modx.banDesc' : 'modx.timeoutDesc')}
      </p>
      <label className="text-[11px] uppercase font-semibold text-fc-muted" htmlFor="mod-duration">{tr('modx.duration')}</label>
      <select id="mod-duration" value={choice} onChange={e => setChoice(Number(e.target.value))}
        className="w-full fc-input text-sm mt-1 mb-3">
        {choices.map(([label], i) => <option key={label} value={i}>{tr(label)}</option>)}
      </select>
      <label className="text-[11px] uppercase font-semibold text-fc-muted" htmlFor="mod-reason">{tr('modx.reason')}</label>
      <textarea id="mod-reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={512} rows={3}
        className="w-full fc-input text-sm mt-1 mb-4 resize-none" />
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 px-3 py-2 rounded-lg bg-fc-hover text-fc-text text-sm">{tr('common.cancel')}</button>
        <button onClick={() => void submit()} disabled={busy}
          className="flex-1 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium disabled:opacity-50">
          {tr(kind === 'ban' ? 'modx.ban' : 'modx.apply')}
        </button>
      </div>
    </Shell>
  )
}

/** Pseudo d'un autre membre (« Gérer les pseudos ») ; vide ou « Réinitialiser » = retirer. */
function NicknameDialog({ serverId, member, onClose }: { serverId: string; member: Member; onClose: () => void }) {
  const qc = useQueryClient()
  const [value, setValue] = useState(member.nickname ?? '')
  const [busy, setBusy] = useState(false)
  const name = member.nickname ?? member.username
  const save = async (nickname: string) => {
    setBusy(true)
    try {
      const next = nickname.trim() || null
      await api.patch(`/servers/${serverId}/members/${member.user_id}/nickname`, { nickname: next })
      qc.setQueryData<Member[]>(['members', serverId], old => old?.map(m => m.user_id === member.user_id ? { ...m, nickname: next } : m))
      void qc.invalidateQueries({ queryKey: ['members_detailed', serverId] })
      toast.success(tr(next ? 'um.nickChanged' : 'um.nickCleared', { name: member.username }))
      onClose()
    } catch (e) {
      toast.error(errorOf(e, tr('mod.refused')))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Shell title={tr('um.nickTitle', { name })} onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); void save(value) }}>
        <label className="text-[11px] uppercase font-semibold text-fc-muted" htmlFor="mod-nick">{tr('um.nickLabel')}</label>
        <input id="mod-nick" value={value} onChange={e => setValue(e.target.value)} maxLength={32} autoFocus
          placeholder={member.username} className="w-full fc-input text-sm mt-1 mb-1" />
        <p className="text-xs text-fc-muted mb-4">{tr('um.nickHint', { name: member.username })}</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => void save('')} disabled={busy || !member.nickname}
            className="flex-1 px-3 py-2 rounded-lg bg-fc-hover text-fc-text text-sm disabled:opacity-50">{tr('um.nickReset')}</button>
          <button type="submit" disabled={busy}
            className="flex-1 px-3 py-2 rounded-lg bg-fc-accent text-white text-sm font-medium disabled:opacity-50">{tr('um.nickSave')}</button>
        </div>
      </form>
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
      toast.error(errorOf(e, tr('modx.noteAddError')))
    }
  }
  const remove = async (id: string) => {
    try {
      await api.delete(`/servers/${serverId}/notes/${id}`)
      void qc.invalidateQueries({ queryKey: key })
    } catch (e) {
      toast.error(errorOf(e, tr('modx.deleteRefused')))
    }
  }
  return (
    <Shell title={tr('modx.notesTitle', { name: member.nickname ?? member.username })} onClose={onClose}>
      <p className="text-xs text-fc-muted mb-2">{tr('modx.notesHint')}</p>
      <div className="space-y-2 mb-3">
        {isLoading && <p className="text-xs text-fc-muted">{tr('common.loading')}</p>}
        {!isLoading && notes.length === 0 && <p className="text-xs text-fc-muted">{tr('modx.noNotes')}</p>}
        {notes.map((n: any) => (
          <div key={n.id} className="bg-fc-bg/60 rounded-lg px-3 py-2 text-sm text-fc-text flex gap-2">
            <div className="flex-1 min-w-0">
              <p className="whitespace-pre-wrap break-words">{n.note}</p>
              <p className="text-[10px] text-fc-muted mt-1">{new Date(n.created_at).toLocaleString(intlLocale())}</p>
            </div>
            <button onClick={() => void remove(n.id)} aria-label={tr('modx.deleteNote')}
              className="self-start p-1 rounded text-fc-muted hover:text-red-400 hover:bg-fc-hover">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <textarea value={text} onChange={e => setText(e.target.value)} maxLength={2000} rows={3}
        placeholder={tr('modx.newNote')} aria-label={tr('modx.newNoteA11y')} className="w-full fc-input text-sm resize-none mb-2" />
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 px-3 py-2 rounded-lg bg-fc-hover text-fc-text text-sm">{tr('common.close')}</button>
        <button onClick={() => void add()} disabled={!text.trim()}
          className="flex-1 btn-primary text-sm py-2 disabled:opacity-50">{tr('modx.add')}</button>
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
    queryFn: () => fetchAllMembers<Member>(serverId!),
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

  /** Pseudo d'un autre membre : « Gérer les pseudos » et rang strictement supérieur. */
  const canRename = (userId: string) => {
    const m = byId.get(userId)
    return !!serverId && !!m && canRenameMember({ self: userId === perms.meId, manage: perms.has(PERM.MANAGE_NICKNAMES), above: perms.outranks(m) })
  }
  const rename = (userId: string) => {
    const m = byId.get(userId)
    if (m) setDialog({ kind: 'nick', member: m })
  }

  const permsChannel = dialog?.kind === 'perms' ? perms.channels.find(c => c.id === dialog.channelId) : undefined
  const node = !serverId || !dialog ? null
    : dialog.kind === 'nick' ? <NicknameDialog serverId={serverId} member={dialog.member} onClose={() => setDialog(null)} />
    : dialog.kind === 'notes' ? <NotesDialog serverId={serverId} member={dialog.member} onClose={() => setDialog(null)} />
    : dialog.kind === 'perms' ? (permsChannel
      ? <ChannelSettingsModal channel={permsChannel} serverId={serverId} onClose={() => setDialog(null)} initialTab="permissions"
          initialTarget={{ id: dialog.member.user_id, name: dialog.member.nickname ?? dialog.member.username, type: 'member' }} />
      : null)
    : <SanctionDialog serverId={serverId} dialog={dialog as Dialog & { kind: 'ban' | 'timeout' }} canBanForever={perms.has(PERM.BAN_MEMBERS)} onClose={() => setDialog(null)} onDone={refresh} />

  return { itemsFor, canRename, rename, node }
}
