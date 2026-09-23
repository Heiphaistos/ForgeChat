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

/**
 * Actions de modération sur un membre (audit P1-9 / P2-2) : expulser, bannir,
 * timeout, notes de modération et modération vocale. Chaque action n'est
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
              <p className="text-[10px] text-fc-muted mt-1">{new Date(n.created_at).toLocaleString('fr-FR')}</p>
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
  const [dialog, setDialog] = useState<Dialog | null>(null)
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
      .catch(e => toast.error(errorOf(e, 'Action refusée')))
  }

  /** Muet / sourdine imposés, déplacer, déconnecter (MUTE / DEAFEN / MOVE_MEMBERS). */
  const voiceItemsFor = (userId: string): ContextMenuEntry[] => {
    const m = byId.get(userId)
    if (!serverId || !m) return []
    const allowed = userId === perms.meId || perms.outranks(m)
    if (!allowed) return []
    const current = voiceChannelOf(userId)
    const live = current ? (roomParticipants[current] ?? []).find(p => p.userId === userId) : undefined
    const muted = live?.serverMuted ?? m.voice_muted ?? false
    const deafened = live?.serverDeafened ?? m.voice_deafened ?? false
    const items: ContextMenuEntry[] = []
    if (perms.has(PERM.MUTE_MEMBERS)) {
      items.push({ label: muted ? 'Rétablir le micro (serveur)' : 'Rendre muet (serveur)',
        onClick: () => moderateVoice(userId, { mute: !muted }, muted ? 'Micro rétabli' : 'Membre rendu muet') })
    }
    if (perms.has(PERM.DEAFEN_MEMBERS)) {
      items.push({ label: deafened ? 'Lever la sourdine (serveur)' : 'Mettre en sourdine (serveur)',
        onClick: () => moderateVoice(userId, { deafen: !deafened }, deafened ? 'Sourdine levée' : 'Membre mis en sourdine') })
    }
    if (current && perms.has(PERM.MOVE_MEMBERS)) {
      items.push({ label: 'Déconnecter du vocal', danger: true,
        onClick: () => moderateVoice(userId, { disconnect: true }, 'Membre déconnecté du vocal') })
      for (const c of voiceChannels) {
        if (c.id === current) continue
        items.push({ label: `Déplacer vers « ${c.name} »`,
          onClick: () => moderateVoice(userId, { channel_id: c.id }, `Déplacé vers « ${c.name} »`) })
      }
    }
    return items.length ? [{ separator: true }, ...items] : []
  }

  /** Expulser / bannir / timeout / notes, puis la modération vocale. */
  const itemsFor = (userId: string): ContextMenuEntry[] => {
    const m = byId.get(userId)
    if (!serverId || !m || userId === perms.meId) return voiceItemsFor(userId)
    const name = m.nickname ?? m.username
    const above = perms.outranks(m)
    const moderator = perms.has(PERM.MANAGE_MESSAGES)
    const timedOut = !!m.timeout_until && new Date(m.timeout_until) > new Date()
    const items: ContextMenuEntry[] = []
    if (above && perms.has(PERM.KICK_MEMBERS)) {
      items.push({ label: 'Expulser', danger: true, onClick: async () => {
        if (!(await confirm({ message: `Expulser ${name} ?`, danger: true, confirmLabel: 'Expulser' }))) return
        api.post(`/servers/${serverId}/members/${userId}/kick`)
          .then(() => { toast.success(`${name} a été expulsé`); refresh() })
          .catch(e => toast.error(errorOf(e, 'Expulsion refusée')))
      } })
    }
    if (above && perms.has(PERM.BAN_MEMBERS | PERM.BAN_TEMP)) {
      items.push({ label: 'Bannir…', danger: true, onClick: () => setDialog({ kind: 'ban', member: m }) })
    }
    if (above && moderator) {
      items.push(timedOut
        ? { label: 'Lever le timeout', onClick: () => {
            api.delete(`/servers/${serverId}/members/${userId}/timeout`)
              .then(() => { toast.success('Timeout levé'); refresh() })
              .catch(e => toast.error(errorOf(e, 'Action refusée')))
          } }
        : { label: 'Timeout…', onClick: () => setDialog({ kind: 'timeout', member: m }) })
    }
    if (moderator) {
      items.push({ label: 'Notes de modération', onClick: () => setDialog({ kind: 'notes', member: m }) })
    }
    return [...(items.length ? [{ separator: true } as const, ...items] : []), ...voiceItemsFor(userId)]
  }

  const node = serverId && dialog
    ? dialog.kind === 'notes'
      ? <NotesDialog serverId={serverId} member={dialog.member} onClose={() => setDialog(null)} />
      : <SanctionDialog serverId={serverId} dialog={dialog as Dialog & { kind: 'ban' | 'timeout' }} canBanForever={perms.has(PERM.BAN_MEMBERS)} onClose={() => setDialog(null)} onDone={refresh} />
    : null

  return { itemsFor, voiceItemsFor, canMove: perms.has(PERM.MOVE_MEMBERS), byId, node }
}
