import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  UserPlus, MessageCircle, Phone, Video, Search, Link, Copy, Check, X,
  Users, MoreVertical, Bell, BellOff, Star, StickyNote, Edit3, UserMinus,
  Ban, Archive, Pin, PhoneCall, PhoneMissed, PhoneIncoming, ChevronDown
} from 'lucide-react'
import api from '../api/client'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'

type Tab = 'online' | 'all' | 'pending' | 'blocked' | 'suggestions' | 'calls'

const STATUS_COLOR: Record<string, string> = {
  online: 'bg-green-500', idle: 'bg-yellow-500',
  dnd: 'bg-red-500', offline: 'bg-gray-500', invisible: 'bg-gray-500',
}
const STATUS_LABEL: Record<string, string> = {
  online: 'En ligne', idle: 'Absent', dnd: 'Ne pas déranger', offline: 'Hors ligne', invisible: 'Invisible',
}

// ── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({ user, size = 10 }: { user: any; size?: number }) {
  const s = `w-${size} h-${size}`
  return (
    <div className={`${s} rounded-full relative flex-shrink-0`}>
      {user.avatar
        ? <img src={user.avatar} alt="" className={`${s} rounded-full object-cover`} />
        : <div className={`${s} rounded-full bg-fc-accent flex items-center justify-center font-bold text-white text-sm`}>
            {(user.custom_nickname || user.username)?.charAt(0)?.toUpperCase()}
          </div>
      }
      <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-fc-channel ${STATUS_COLOR[user.user_status ?? user.status] ?? 'bg-gray-500'}`} />
    </div>
  )
}

// ── Context Menu ──────────────────────────────────────────────────────────────
function FriendMenu({ friend, onClose, onAction }: { friend: any; onClose: () => void; onAction: (a: string, f: any) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])
  const item = (icon: React.ReactNode, label: string, action: string, danger = false) => (
    <button onClick={() => { onAction(action, friend); onClose() }}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded transition text-left
        ${danger ? 'text-red-400 hover:bg-red-500/10' : 'text-fc-text hover:bg-fc-hover'}`}>
      {icon}{label}
    </button>
  )
  return (
    <div ref={ref} className="absolute right-0 top-8 z-50 w-52 bg-fc-bg border border-fc-hover rounded-xl shadow-2xl py-1 overflow-hidden">
      {item(<MessageCircle size={15}/>, 'Message privé', 'dm')}
      {item(<Phone size={15}/>, 'Appel vocal', 'call-voice')}
      {item(<Video size={15}/>, 'Appel vidéo', 'call-video')}
      <div className="h-px bg-fc-hover my-1" />
      {item(<Edit3 size={15}/>, 'Modifier le surnom', 'nickname')}
      {item(<StickyNote size={15}/>, 'Ajouter une note', 'note')}
      {item(<Star size={15}/>, 'Ajouter aux favoris', 'favorite')}
      {friend.notify_online
        ? item(<BellOff size={15}/>, 'Désactiver notif connexion', 'notify-off')
        : item(<Bell size={15}/>, 'Notifier à la connexion', 'notify-on')}
      <div className="h-px bg-fc-hover my-1" />
      {item(<UserMinus size={15}/>, 'Retirer des amis', 'remove', true)}
      {item(<Ban size={15}/>, 'Bloquer', 'block', true)}
    </div>
  )
}

// ── Modale : Surnom ───────────────────────────────────────────────────────────
function NicknameModal({ friend, onClose }: { friend: any; onClose: () => void }) {
  const [val, setVal] = useState(friend.custom_nickname ?? '')
  const qc = useQueryClient()
  const save = useMutation({
    mutationFn: () => api.put(`/friends/${friend.friend_id}/nickname`, { nickname: val }),
    onSuccess: () => { toast.success('Surnom mis à jour'); qc.invalidateQueries({ queryKey: ['friends-v2'] }); onClose() },
  })
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-fc-channel rounded-2xl p-6 w-80 shadow-2xl">
        <h3 className="font-bold text-white mb-1">Surnom pour {friend.username}</h3>
        <p className="text-xs text-fc-muted mb-4">Visible uniquement par toi · vide = supprimer</p>
        <input value={val} onChange={e => setVal(e.target.value)}
          placeholder={friend.username} maxLength={64}
          onKeyDown={e => e.key === 'Enter' && save.mutate()}
          className="w-full px-3 py-2 bg-fc-input rounded-lg text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm mb-4" />
        <div className="flex gap-2">
          <button onClick={() => save.mutate()} disabled={save.isPending}
            className="flex-1 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition disabled:opacity-50">
            Enregistrer
          </button>
          <button onClick={onClose} className="flex-1 py-2 bg-fc-hover text-fc-muted rounded-lg text-sm transition">Annuler</button>
        </div>
      </div>
    </div>
  )
}

// ── Modale : Note ─────────────────────────────────────────────────────────────
function NoteModal({ friend, onClose }: { friend: any; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ['friend-note', friend.friend_id],
    queryFn: () => api.get(`/friends/${friend.friend_id}/note`).then(r => r.data),
  })
  const [val, setVal] = useState('')
  useEffect(() => { if (data?.note !== undefined) setVal(data.note) }, [data])
  const qc = useQueryClient()
  const save = useMutation({
    mutationFn: () => api.put(`/friends/${friend.friend_id}/note`, { note: val }),
    onSuccess: () => { toast.success('Note sauvegardée'); qc.invalidateQueries({ queryKey: ['friend-note', friend.friend_id] }); onClose() },
  })
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-fc-channel rounded-2xl p-6 w-96 shadow-2xl">
        <h3 className="font-bold text-white mb-1">Note sur {friend.custom_nickname || friend.username}</h3>
        <p className="text-xs text-fc-muted mb-4">Privée · uniquement visible par toi</p>
        <textarea value={val} onChange={e => setVal(e.target.value)} rows={6} maxLength={2000}
          placeholder="Ajoute une note sur cet ami..."
          className="w-full px-3 py-2 bg-fc-input rounded-lg text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm resize-none mb-1" />
        <div className="text-xs text-fc-muted mb-4 text-right">{val.length}/2000</div>
        <div className="flex gap-2">
          <button onClick={() => save.mutate()} disabled={save.isPending}
            className="flex-1 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition disabled:opacity-50">
            Sauvegarder
          </button>
          <button onClick={onClose} className="flex-1 py-2 bg-fc-hover text-fc-muted rounded-lg text-sm transition">Annuler</button>
        </div>
      </div>
    </div>
  )
}

// ── Modale : Ajouter un ami ───────────────────────────────────────────────────
function AddFriendModal({ onClose }: { onClose: () => void }) {
  const [subTab, setSubTab] = useState<'name' | 'link'>('name')
  const [input, setInput] = useState('')
  const [msg, setMsg] = useState('')
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const qc = useQueryClient()

  const sendByName = useMutation({
    mutationFn: () => api.post('/friends/by-name', { name: input.trim(), message: msg.trim() || undefined }),
    onSuccess: () => { toast.success('Demande envoyée !'); qc.invalidateQueries({ queryKey: ['friends-v2'] }); setInput(''); setMsg('') },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })
  const sendById = useMutation({
    mutationFn: () => api.post('/friends', { user_id: input.trim() }),
    onSuccess: () => { toast.success('Demande envoyée !'); qc.invalidateQueries({ queryKey: ['friends-v2'] }); setInput('') },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })
  const createLink = useMutation({
    mutationFn: () => api.post('/friends/invite').then(r => r.data),
    onSuccess: (d: any) => setInviteUrl(d.url),
  })
  const isUuid = /^[0-9a-f-]{36}$/i.test(input.trim())

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-fc-channel rounded-2xl w-[480px] shadow-2xl overflow-hidden">
        <div className="p-6 border-b border-fc-hover flex items-center justify-between">
          <h2 className="font-bold text-white text-lg">Ajouter un ami</h2>
          <button onClick={onClose} className="text-fc-muted hover:text-white transition"><X size={20}/></button>
        </div>
        <div className="flex border-b border-fc-hover">
          {(['name', 'link'] as const).map(t => (
            <button key={t} onClick={() => setSubTab(t)}
              className={`flex-1 py-3 text-sm font-medium transition ${subTab === t ? 'text-white border-b-2 border-fc-accent' : 'text-fc-muted hover:text-white'}`}>
              {t === 'name' ? "Par nom d'utilisateur" : "Lien d'invitation"}
            </button>
          ))}
        </div>
        <div className="p-6">
          {subTab === 'name' && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2 block">
                  Nom d'utilisateur ou ID
                </label>
                <input value={input} onChange={e => setInput(e.target.value)}
                  placeholder="utilisateur#1234 ou UUID"
                  onKeyDown={e => e.key === 'Enter' && input && (isUuid ? sendById.mutate() : sendByName.mutate())}
                  className="w-full px-3 py-2.5 bg-fc-input rounded-lg text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2 block">
                  Message (optionnel)
                </label>
                <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={2} maxLength={256}
                  placeholder="Salut, on se connaît de..."
                  className="w-full px-3 py-2 bg-fc-input rounded-lg text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm resize-none" />
              </div>
              <button
                onClick={() => isUuid ? sendById.mutate() : sendByName.mutate()}
                disabled={!input.trim() || sendByName.isPending || sendById.isPending}
                className="w-full py-2.5 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition disabled:opacity-50">
                Envoyer la demande
              </button>
            </div>
          )}
          {subTab === 'link' && (
            <div className="space-y-4">
              <p className="text-sm text-fc-muted">
                Génère un lien unique valable 7 jours. Quiconque clique sur ce lien devient ton ami directement.
              </p>
              {inviteUrl ? (
                <div className="flex gap-2">
                  <input readOnly value={inviteUrl}
                    className="flex-1 px-3 py-2 bg-fc-input rounded-lg text-white text-sm outline-none" />
                  <button onClick={() => { navigator.clipboard.writeText(inviteUrl); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-1.5
                      ${copied ? 'bg-green-600 text-white' : 'bg-fc-accent hover:bg-indigo-500 text-white'}`}>
                    {copied ? <Check size={14}/> : <Copy size={14}/>}
                    {copied ? 'Copié !' : 'Copier'}
                  </button>
                </div>
              ) : (
                <button onClick={() => createLink.mutate()} disabled={createLink.isPending}
                  className="w-full py-2.5 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition disabled:opacity-50 flex items-center justify-center gap-2">
                  <Link size={16}/>
                  {createLink.isPending ? 'Génération...' : "Générer un lien d'invitation"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Carte ami ─────────────────────────────────────────────────────────────────
function FriendCard({ friend, onAction }: { friend: any; onAction: (a: string, f: any) => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const displayName = friend.custom_nickname || friend.username
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-fc-hover/50 transition group relative">
      <Avatar user={friend} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-white text-sm truncate">{displayName}</span>
          {friend.custom_nickname && (
            <span className="text-xs text-fc-muted truncate hidden sm:inline">({friend.username}#{friend.discriminator})</span>
          )}
          {friend.notify_online && (
            <span title="Notification connexion activée"><Bell size={11} className="text-yellow-400 flex-shrink-0" /></span>
          )}
        </div>
        <div className="text-xs text-fc-muted truncate">
          {friend.activity_name
            ? <span className="text-indigo-400">🎮 {friend.activity_name}</span>
            : friend.custom_status
            ? <span className="italic">"{friend.custom_status}"</span>
            : STATUS_LABEL[friend.user_status] ?? 'Hors ligne'
          }
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
        <button onClick={() => onAction('dm', friend)} title="Message"
          className="p-2 rounded-full bg-fc-channel hover:bg-fc-input text-fc-muted hover:text-white transition">
          <MessageCircle size={16}/>
        </button>
        <button onClick={() => onAction('call-voice', friend)} title="Appel vocal"
          className="p-2 rounded-full bg-fc-channel hover:bg-fc-input text-fc-muted hover:text-white transition">
          <Phone size={16}/>
        </button>
        <div className="relative">
          <button onClick={() => setMenuOpen(v => !v)}
            className="p-2 rounded-full bg-fc-channel hover:bg-fc-input text-fc-muted hover:text-white transition">
            <MoreVertical size={16}/>
          </button>
          {menuOpen && <FriendMenu friend={friend} onClose={() => setMenuOpen(false)} onAction={onAction} />}
        </div>
      </div>
    </div>
  )
}

// ── Panel groupes ─────────────────────────────────────────────────────────────
function GroupsPanel({ onFilterGroup, activeIds }: { onFilterGroup: (ids: string[] | null) => void; activeIds: string[] | null }) {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [expanded, setExpanded] = useState(true)

  const { data: groups = [] } = useQuery({
    queryKey: ['friend-groups'],
    queryFn: () => api.get('/friends/groups').then(r => r.data),
  })
  const createGroup = useMutation({
    mutationFn: () => api.post('/friends/groups', { name: newName }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['friend-groups'] }); setNewName(''); setAdding(false) },
  })
  const delGroup = useMutation({
    mutationFn: (id: string) => api.delete(`/friends/groups/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['friend-groups'] }); onFilterGroup(null) },
  })

  return (
    <div className="w-48 flex-shrink-0 border-r border-fc-hover p-2 overflow-y-auto">
      <button onClick={() => onFilterGroup(null)}
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition mb-1 ${!activeIds ? 'bg-fc-hover text-white' : 'text-fc-muted hover:bg-fc-hover/50 hover:text-white'}`}>
        <Users size={14}/> Tous
      </button>
      <div className="flex items-center justify-between px-3 py-1.5 mt-1">
        <button onClick={() => setExpanded(v => !v)} className="flex items-center gap-1 text-xs font-semibold text-fc-muted uppercase tracking-wide hover:text-white transition">
          {expanded ? <ChevronDown size={11}/> : <ChevronDown size={11} className="-rotate-90"/>}
          Groupes
        </button>
        <button onClick={() => setAdding(v => !v)} className="text-fc-muted hover:text-white transition text-xs">+</button>
      </div>
      {adding && expanded && (
        <div className="px-2 mb-1">
          <input value={newName} onChange={e => setNewName(e.target.value)}
            placeholder="Nouveau groupe..." maxLength={64}
            onKeyDown={e => { if (e.key === 'Enter' && newName) createGroup.mutate(); if (e.key === 'Escape') setAdding(false) }}
            autoFocus
            className="w-full px-2 py-1.5 bg-fc-input rounded text-white text-xs outline-none focus:ring-1 focus:ring-fc-accent" />
        </div>
      )}
      {expanded && (groups as any[]).map((g: any) => (
        <div key={g.id} className="group/grp relative">
          <button onClick={() => onFilterGroup(g.member_ids ?? [])}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition ${activeIds !== null && JSON.stringify(activeIds) === JSON.stringify(g.member_ids) ? 'bg-fc-hover text-white' : 'text-fc-muted hover:bg-fc-hover/50 hover:text-white'}`}>
            <span className="text-base">📁</span>
            <span className="flex-1 truncate text-left">{g.name}</span>
            <span className="text-xs opacity-60">{g.member_ids?.length ?? 0}</span>
          </button>
          <button onClick={() => delGroup.mutate(g.id)}
            className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/grp:opacity-100 transition p-1 text-fc-muted hover:text-red-400 rounded">
            <X size={11}/>
          </button>
        </div>
      ))}
    </div>
  )
}

// ── Historique appels ─────────────────────────────────────────────────────────
function CallHistory() {
  const { data: calls = [] } = useQuery({
    queryKey: ['call-history'],
    queryFn: () => api.get('/friends/calls').then(r => r.data),
  })
  const nav = useNavigate()
  if (!(calls as any[]).length) return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <PhoneCall size={40} className="text-fc-muted/30"/>
      <p className="text-fc-muted text-sm">Aucun appel récent</p>
    </div>
  )
  return (
    <div className="space-y-0.5 p-2">
      {(calls as any[]).map((c: any) => {
        const Icon = c.status === 'missed' ? PhoneMissed : c.direction === 'incoming' ? PhoneIncoming : PhoneCall
        const color = c.status === 'missed' ? 'text-red-400' : 'text-green-400'
        return (
          <div key={c.id} className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-fc-hover/50 transition">
            <div className="w-10 h-10 rounded-full bg-fc-accent flex items-center justify-center text-white font-bold flex-shrink-0">
              {c.other_user.username?.charAt(0)?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-white text-sm">{c.other_user.username}</div>
              <div className={`text-xs flex items-center gap-1 ${color}`}>
                <Icon size={11}/>
                {c.call_type === 'video' ? 'Appel vidéo' : 'Appel vocal'} ·{' '}
                {formatDistanceToNow(new Date(c.started_at), { locale: fr, addSuffix: true })}
                {c.duration_s != null && ` · ${Math.floor(c.duration_s / 60)}m${c.duration_s % 60}s`}
              </div>
            </div>
            {c.dm_id && (
              <button onClick={() => nav(`/dms/${c.dm_id}`)} title="Rappeler"
                className="p-2 rounded-full bg-fc-channel hover:bg-green-600/20 text-fc-muted hover:text-green-400 transition">
                <Phone size={14}/>
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────
export default function FriendsPage() {
  const [tab, setTab] = useState<Tab>('online')
  const [search, setSearch] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [nicknameFor, setNicknameFor] = useState<any>(null)
  const [noteFor, setNoteFor] = useState<any>(null)
  const [groupFilter, setGroupFilter] = useState<string[] | null>(null)
  const qc = useQueryClient()
  const nav = useNavigate()

  const filterParam = tab === 'online' ? 'online' : tab === 'pending' ? 'pending' : tab === 'blocked' ? 'blocked' : 'all'

  const { data: friendsData } = useQuery({
    queryKey: ['friends-v2', filterParam, search],
    queryFn: () => api.get('/friends/v2', { params: { filter: filterParam, q: search } }).then(r => r.data),
    refetchInterval: 30_000,
  })

  const { data: suggestions = [] } = useQuery({
    queryKey: ['friend-suggestions'],
    queryFn: () => api.get('/friends/suggestions').then(r => r.data),
    enabled: tab === 'suggestions',
  })

  const friends: any[] = friendsData?.friends ?? []
  const counts = friendsData?.counts ?? {}

  const filtered = groupFilter
    ? friends.filter(f => groupFilter.includes(f.friend_id))
    : friends

  const accept = useMutation({
    mutationFn: (id: string) => api.post(`/friends/${id}/accept`),
    onSuccess: () => { toast.success('Ami ajouté !'); qc.invalidateQueries({ queryKey: ['friends-v2'] }) },
  })
  const cancel = useMutation({
    mutationFn: (id: string) => api.delete(`/friends/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends-v2'] }),
  })
  const decline = useMutation({
    mutationFn: (id: string) => api.post(`/friends/${id}/decline`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends-v2'] }),
  })
  const sendRequest = useMutation({
    mutationFn: (uid: string) => api.post('/friends', { user_id: uid }),
    onSuccess: () => { toast.success('Demande envoyée !'); qc.invalidateQueries({ queryKey: ['friend-suggestions'] }) },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const handleAction = async (action: string, friend: any) => {
    try {
      switch (action) {
        case 'dm': {
          const { data } = await api.post(`/dms/${friend.friend_id}`)
          nav(`/dms/${data.dm_id}`)
          break
        }
        case 'call-voice':
        case 'call-video': {
          const { data } = await api.post(`/dms/${friend.friend_id}`)
          nav(`/dms/${data.dm_id}?call=${action === 'call-video' ? 'video' : 'voice'}`)
          break
        }
        case 'nickname': setNicknameFor(friend); break
        case 'note':     setNoteFor(friend); break
        case 'favorite':
          await api.post(`/users/${friend.friend_id}/favorite`)
          toast.success('Ajouté aux favoris')
          break
        case 'notify-on':
          await api.put(`/friends/${friend.friend_id}/notify`, { enabled: true })
          toast.success('Tu seras notifié à sa connexion')
          qc.invalidateQueries({ queryKey: ['friends-v2'] })
          break
        case 'notify-off':
          await api.put(`/friends/${friend.friend_id}/notify`, { enabled: false })
          toast.success('Notification désactivée')
          qc.invalidateQueries({ queryKey: ['friends-v2'] })
          break
        case 'remove':
          if (window.confirm(`Retirer ${friend.username} de tes amis ?`)) {
            await api.delete(`/friends/${friend.friend_id}`)
            toast.success('Ami retiré')
            qc.invalidateQueries({ queryKey: ['friends-v2'] })
          }
          break
        case 'block':
          if (window.confirm(`Bloquer ${friend.username} ?`)) {
            await api.post(`/users/${friend.friend_id}/block`)
            toast.success('Utilisateur bloqué')
            qc.invalidateQueries({ queryKey: ['friends-v2'] })
          }
          break
      }
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? 'Erreur')
    }
  }

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'online',      label: 'En ligne',    count: counts.online },
    { id: 'all',         label: 'Tous',        count: counts.all },
    { id: 'pending',     label: 'En attente',  count: counts.pending_received },
    { id: 'blocked',     label: 'Bloqués' },
    { id: 'suggestions', label: 'Suggestions' },
    { id: 'calls',       label: 'Appels' },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-fc-bg shadow-sm flex-shrink-0 flex-wrap gap-y-1">
        <span className="font-semibold text-white flex items-center gap-2">
          <Users size={18} className="text-fc-accent"/> Amis
        </span>
        <div className="flex gap-0.5 flex-wrap">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-3 py-1 rounded-lg text-sm font-medium transition flex items-center gap-1
                ${tab === t.id ? 'bg-fc-hover text-white' : 'text-fc-muted hover:text-white hover:bg-fc-hover/50'}`}>
              {t.label}
              {(t.count ?? 0) > 0 && (
                <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">{t.count}</span>
              )}
            </button>
          ))}
        </div>
        <button onClick={() => setShowAddModal(true)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition">
          <UserPlus size={15}/> Ajouter
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {(tab === 'all' || tab === 'online') && (
          <GroupsPanel onFilterGroup={setGroupFilter} activeIds={groupFilter} />
        )}

        <div className="flex-1 flex flex-col overflow-hidden">
          {tab !== 'calls' && tab !== 'suggestions' && (
            <div className="px-4 pt-3 pb-1 flex-shrink-0">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fc-muted"/>
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Rechercher..."
                  className="w-full pl-9 pr-3 py-1.5 bg-fc-input rounded-lg text-white outline-none text-sm" />
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto py-2">

            {tab === 'calls' && <CallHistory />}

            {tab === 'suggestions' && (
              <div className="px-2">
                <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide px-4 py-2">
                  Personnes que tu pourrais connaître · {(suggestions as any[]).length}
                </div>
                {!(suggestions as any[]).length && (
                  <p className="text-fc-muted text-sm px-4">Rejoins des serveurs ou ajoute des amis pour voir des suggestions.</p>
                )}
                {(suggestions as any[]).map((s: any) => (
                  <div key={s.id} className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-fc-hover/50 transition">
                    <div className="w-10 h-10 rounded-full bg-fc-accent flex items-center justify-center text-white font-bold flex-shrink-0">
                      {s.username?.charAt(0)?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-white text-sm">{s.username}#{s.discriminator}</div>
                      <div className="text-xs text-fc-muted">
                        {s.mutual_friends > 0 && `${s.mutual_friends} ami(s) en commun`}
                        {s.mutual_friends > 0 && s.mutual_servers > 0 && ' · '}
                        {s.mutual_servers > 0 && `${s.mutual_servers} serveur(s) en commun`}
                      </div>
                    </div>
                    <button onClick={() => sendRequest.mutate(s.id)} disabled={sendRequest.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition disabled:opacity-50">
                      <UserPlus size={12}/> Ajouter
                    </button>
                  </div>
                ))}
              </div>
            )}

            {tab === 'pending' && (
              <div className="px-2">
                {filtered.filter(f => f.direction === 'received').length > 0 && (
                  <>
                    <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide px-4 py-2">
                      Demandes reçues · {filtered.filter(f => f.direction === 'received').length}
                    </div>
                    {filtered.filter(f => f.direction === 'received').map(f => (
                      <div key={f.id} className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-fc-hover/50 transition">
                        <div className="w-10 h-10 rounded-full bg-fc-accent flex items-center justify-center text-white font-bold flex-shrink-0">
                          {f.username?.charAt(0)?.toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-white text-sm">{f.username}#{f.discriminator}</div>
                          {f.message && <p className="text-xs text-fc-muted italic truncate">"{f.message}"</p>}
                          <div className="text-xs text-fc-muted">
                            {f.requested_at && formatDistanceToNow(new Date(f.requested_at), { locale: fr, addSuffix: true })}
                          </div>
                        </div>
                        <button onClick={() => accept.mutate(f.id)}
                          className="p-2 bg-green-600/20 hover:bg-green-600/40 text-green-400 rounded-full transition" title="Accepter">
                          <Check size={16}/>
                        </button>
                        <button onClick={() => decline.mutate(f.id)}
                          className="p-2 bg-red-500/20 hover:bg-red-500/40 text-red-400 rounded-full transition" title="Refuser">
                          <X size={16}/>
                        </button>
                      </div>
                    ))}
                  </>
                )}
                {filtered.filter(f => f.direction === 'sent').length > 0 && (
                  <>
                    <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide px-4 py-2 mt-2">
                      Demandes envoyées · {filtered.filter(f => f.direction === 'sent').length}
                    </div>
                    {filtered.filter(f => f.direction === 'sent').map(f => (
                      <div key={f.id} className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-fc-hover/50 transition">
                        <div className="w-10 h-10 rounded-full bg-fc-accent flex items-center justify-center text-white font-bold flex-shrink-0">
                          {f.username?.charAt(0)?.toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-white text-sm">{f.username}#{f.discriminator}</div>
                          <div className="text-xs text-fc-muted">En attente de réponse...</div>
                        </div>
                        <button onClick={() => cancel.mutate(f.id)}
                          className="px-3 py-1.5 bg-fc-hover hover:bg-red-500/20 text-fc-muted hover:text-red-400 rounded-lg text-xs transition">
                          Annuler
                        </button>
                      </div>
                    ))}
                  </>
                )}
                {filtered.length === 0 && (
                  <p className="text-fc-muted text-sm px-4 py-4">Aucune demande en attente.</p>
                )}
              </div>
            )}

            {tab === 'blocked' && (
              <div className="px-2">
                <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide px-4 py-2">
                  Bloqués · {filtered.length}
                </div>
                {filtered.map(f => (
                  <div key={f.id} className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-fc-hover/50 transition">
                    <div className="w-10 h-10 rounded-full bg-fc-muted/30 flex items-center justify-center text-fc-muted font-bold flex-shrink-0">
                      {f.username?.charAt(0)?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-white text-sm">{f.username}</div>
                    </div>
                    <button onClick={async () => {
                      await api.delete(`/users/${f.friend_id}/block`)
                      toast.success('Débloqué')
                      qc.invalidateQueries({ queryKey: ['friends-v2'] })
                    }} className="px-3 py-1.5 bg-fc-hover hover:bg-fc-input text-fc-muted hover:text-white rounded-lg text-xs transition">
                      Débloquer
                    </button>
                  </div>
                ))}
                {!filtered.length && <p className="text-fc-muted text-sm px-4">Aucun utilisateur bloqué.</p>}
              </div>
            )}

            {(tab === 'online' || tab === 'all') && (
              <div className="px-2">
                {filtered.length > 0 && (
                  <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide px-4 py-2">
                    {tab === 'online' ? 'En ligne' : 'Tous les amis'} — {filtered.length}
                  </div>
                )}
                {filtered.map(f => <FriendCard key={f.id} friend={f} onAction={handleAction} />)}
                {!filtered.length && (
                  <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <Users size={48} className="text-fc-muted/30"/>
                    <p className="text-fc-muted text-sm">
                      {tab === 'online' ? 'Aucun ami en ligne' : 'Aucun ami pour le moment'}
                    </p>
                    <button onClick={() => setShowAddModal(true)}
                      className="flex items-center gap-1.5 px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-sm transition">
                      <UserPlus size={15}/> Ajouter un ami
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showAddModal && <AddFriendModal onClose={() => setShowAddModal(false)} />}
      {nicknameFor && <NicknameModal friend={nicknameFor} onClose={() => setNicknameFor(null)} />}
      {noteFor && <NoteModal friend={noteFor} onClose={() => setNoteFor(null)} />}
    </div>
  )
}
