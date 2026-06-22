import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  UserPlus, MessageCircle, Check, X, Link, Copy, Search,
  MoreHorizontal, UserX, Shield, User, Wifi, WifiOff,
  Clock, MinusCircle,
} from 'lucide-react'
import api from '../api/client'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { usePresence } from '../store/presence'

type FriendTab = 'online' | 'all' | 'pending' | 'blocked'
type PendingSubTab = 'received' | 'sent'

interface FriendRow {
  id: string
  friend_id: string
  status: 'accepted' | 'pending'
  direction?: 'received' | 'sent'
  username: string
  discriminator: string
  avatar: string | null
  user_status: string
  custom_status?: string | null
}

interface BlockedRow {
  id: string
  username: string
  discriminator: string
  avatar: string | null
}

const STATUS_COLOR: Record<string, string> = {
  online:    'bg-fc-green',
  idle:      'bg-fc-yellow',
  dnd:       'bg-fc-red',
  invisible: 'bg-fc-muted',
  offline:   'bg-fc-muted',
}

const STATUS_LABEL: Record<string, string> = {
  online:  'En ligne',
  idle:    'Absent',
  dnd:     'Ne pas déranger',
  offline: 'Hors ligne',
}

function AvatarWithStatus({
  username, avatar, status, size = 10,
}: { username: string; avatar: string | null; status: string; size?: number }) {
  const avatarSize = size === 10 ? 'w-10 h-10' : 'w-8 h-8'
  const dotPos = size === 10 ? '-bottom-0.5 -right-0.5 w-3.5 h-3.5' : '-bottom-0.5 -right-0.5 w-3 h-3'
  return (
    <div className="relative flex-shrink-0">
      <div className={`${avatarSize} rounded-full bg-fc-accent flex items-center justify-center font-bold text-white overflow-hidden`}>
        {avatar
          ? <img src={avatar} alt="" className="w-full h-full object-cover" />
          : username.charAt(0).toUpperCase()}
      </div>
      <div className={`absolute ${dotPos} rounded-full border-2 border-fc-channel ${STATUS_COLOR[status] ?? 'bg-fc-muted'}`} />
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-fc-channel/40 animate-pulse">
      <div className="w-10 h-10 rounded-full bg-fc-hover flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3 bg-fc-hover rounded w-32" />
        <div className="h-2.5 bg-fc-hover rounded w-20" />
      </div>
    </div>
  )
}

export default function FriendsPage() {
  const [tab, setTab] = useState<FriendTab>('all')
  const [pendingSubTab, setPendingSubTab] = useState<PendingSubTab>('received')
  const [addTag, setAddTag] = useState('')
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [search, setSearch] = useState('')
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const qc = useQueryClient()
  const nav = useNavigate()
  const getStatus = usePresence(s => s.getStatus)

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: friends = [], isLoading } = useQuery<FriendRow[]>({
    queryKey: ['friends'],
    queryFn: () => api.get('/friends').then(r => r.data),
  })

  const { data: blocked = [] } = useQuery<BlockedRow[]>({
    queryKey: ['friends_blocked'],
    queryFn: () => api.get('/friends/blocked').then(r => r.data),
    enabled: tab === 'blocked',
  })

  // ── Derived lists ──────────────────────────────────────────────────────────
  const accepted = useMemo(
    () => friends.filter(f => f.status === 'accepted'),
    [friends]
  )
  const pendingReceived = useMemo(
    () => friends.filter(f => f.status === 'pending' && f.direction !== 'sent'),
    [friends]
  )
  const pendingSent = useMemo(
    () => friends.filter(f => f.status === 'pending' && f.direction === 'sent'),
    [friends]
  )
  const online = useMemo(
    () => accepted.filter(f => {
      const live = getStatus(f.friend_id)
      return (live || f.user_status) === 'online'
    }),
    [accepted, getStatus]
  )

  const filteredAccepted = useMemo(() => {
    const src = tab === 'online' ? online : accepted
    if (!search.trim()) return src
    const q = search.toLowerCase()
    return src.filter(f =>
      f.username.toLowerCase().includes(q) ||
      `${f.username}#${f.discriminator}`.toLowerCase().includes(q)
    )
  }, [tab, online, accepted, search])

  // ── Mutations ──────────────────────────────────────────────────────────────
  const createInvite = useMutation({
    mutationFn: () => api.post('/friends/invite').then(r => r.data),
    onSuccess: (data: { url: string }) => setInviteUrl(data.url),
    onError: () => toast.error('Erreur lors de la création du lien'),
  })

  const sendRequest = useMutation({
    mutationFn: (tag: string) => api.post('/friends', { tag }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['friends'] })
      setAddTag('')
      toast.success('Demande envoyée !')
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { error?: string } } }
      toast.error(err.response?.data?.error ?? 'Utilisateur introuvable')
    },
  })

  const accept = useMutation({
    mutationFn: (id: string) => api.post(`/friends/${id}/accept`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
    onError: () => toast.error('Erreur lors de l\'acceptation'),
  })

  const decline = useMutation({
    mutationFn: (id: string) => api.post(`/friends/${id}/decline`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
  })

  const remove = useMutation({
    mutationFn: (friendId: string) => api.delete(`/friends/${friendId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['friends'] })
      toast.success('Ami supprimé')
    },
  })

  const blockUser = useMutation({
    mutationFn: (userId: string) => api.post(`/friends/block/${userId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['friends'] })
      qc.invalidateQueries({ queryKey: ['friends_blocked'] })
      toast.success('Utilisateur bloqué')
    },
  })

  const unblockUser = useMutation({
    mutationFn: (userId: string) => api.delete(`/friends/block/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends_blocked'] }),
  })

  const openDm = async (userId: string) => {
    try {
      const { data } = await api.post(`/dms/${userId}`)
      nav(`/dms/${data.dm_id}`)
    } catch {
      toast.error('Impossible d\'ouvrir le DM')
    }
  }

  const copyInviteUrl = () => {
    if (!inviteUrl) return
    navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const pendingCount = pendingReceived.length

  // ── Tab button ─────────────────────────────────────────────────────────────
  const TabBtn = ({ t, label, count }: { t: FriendTab; label: string; count?: number }) => (
    <button
      onClick={() => setTab(t)}
      className={`px-3 py-1.5 rounded text-sm font-medium transition
        ${tab === t
          ? 'bg-fc-hover text-white'
          : 'text-fc-muted hover:text-white hover:bg-fc-hover/50'}`}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span className="ml-1.5 bg-fc-red text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
          {count}
        </span>
      )}
    </button>
  )

  // ── Friend card (render function, pas un composant React) ─────────────────
  const renderFriendCard = (f: FriendRow) => {
    const live = getStatus(f.friend_id) || f.user_status
    const isOpen = menuOpen === f.id

    return (
      <div
        key={f.id}
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-fc-hover transition group relative"
        onClick={() => isOpen && setMenuOpen(null)}
      >
        <AvatarWithStatus username={f.username} avatar={f.avatar} status={live} />

        <div className="flex-1 min-w-0">
          <div className="font-medium text-white text-sm leading-tight">
            {f.username}
            <span className="text-fc-muted font-normal text-xs ml-0.5">
              #{f.discriminator}
            </span>
          </div>
          <div className="text-xs text-fc-muted truncate mt-0.5">
            {f.custom_status ?? STATUS_LABEL[live] ?? 'Hors ligne'}
          </div>
        </div>

        {/* Actions (visibles au hover) */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
          <button
            onClick={e => { e.stopPropagation(); openDm(f.friend_id) }}
            title="Envoyer un message"
            className="p-1.5 text-fc-muted hover:text-white rounded hover:bg-fc-input transition"
          >
            <MessageCircle size={16} />
          </button>

          <div className="relative">
            <button
              onClick={e => { e.stopPropagation(); setMenuOpen(isOpen ? null : f.id) }}
              title="Plus d'options"
              className="p-1.5 text-fc-muted hover:text-white rounded hover:bg-fc-input transition"
            >
              <MoreHorizontal size={16} />
            </button>

            {isOpen && (
              <div className="absolute right-0 top-8 z-20 bg-fc-bg border border-fc-hover rounded-lg shadow-xl py-1 w-40"
                onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => { nav(`/users/${f.friend_id}`); setMenuOpen(null) }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-fc-text hover:bg-fc-hover transition"
                >
                  <User size={14} /> Profil
                </button>
                <button
                  onClick={() => { remove.mutate(f.friend_id); setMenuOpen(null) }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-fc-red hover:bg-fc-hover transition"
                >
                  <UserX size={14} /> Supprimer
                </button>
                <button
                  onClick={() => { blockUser.mutate(f.friend_id); setMenuOpen(null) }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-fc-red hover:bg-fc-hover transition"
                >
                  <Shield size={14} /> Bloquer
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full" onClick={() => menuOpen && setMenuOpen(null)}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-fc-bg shadow-sm flex-shrink-0 flex-wrap gap-y-2">
        <span className="font-semibold text-white flex-shrink-0">Amis</span>
        <div className="flex gap-1 flex-wrap">
          <TabBtn t="online" label="En ligne" count={online.length} />
          <TabBtn t="all" label="Tous" />
          <TabBtn t="pending" label="En attente" count={pendingCount} />
          <TabBtn t="blocked" label="Bloqués" />
          <button
            onClick={() => setTab('pending')}
            className="px-3 py-1.5 rounded text-sm font-medium bg-fc-accent hover:bg-indigo-500 text-white transition ml-1"
          >
            + Ajouter un ami
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">

        {/* ── TAB: Ajouter (form dans En attente) ─── */}
        {tab === 'pending' && (
          <div className="max-w-2xl mb-6 p-4 bg-fc-channel rounded-xl border border-fc-hover">
            <h3 className="font-semibold text-white mb-1 flex items-center gap-2">
              <UserPlus size={16} className="text-fc-accent" />
              Ajouter un ami
            </h3>
            <p className="text-fc-muted text-xs mb-3">
              Entre le tag complet : <span className="text-fc-text font-mono">username#0000</span>
            </p>
            <div className="flex gap-2">
              <input
                value={addTag}
                onChange={e => setAddTag(e.target.value)}
                placeholder="username#0000"
                className="flex-1 px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm font-mono"
                onKeyDown={e => e.key === 'Enter' && addTag.includes('#') && sendRequest.mutate(addTag)}
              />
              <button
                onClick={() => addTag.includes('#') && sendRequest.mutate(addTag)}
                disabled={!addTag.includes('#') || sendRequest.isPending}
                className="px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition disabled:opacity-40"
              >
                {sendRequest.isPending ? '…' : 'Envoyer'}
              </button>
            </div>

            {/* Lien d'invitation */}
            <div className="mt-4 pt-4 border-t border-fc-hover">
              <p className="text-xs text-fc-muted mb-2 flex items-center gap-1.5">
                <Link size={12} className="text-fc-accent" />
                Ou invite via un lien (valable 7 jours)
              </p>
              {inviteUrl ? (
                <div className="flex gap-2">
                  <input readOnly value={inviteUrl}
                    className="flex-1 px-2 py-1.5 bg-fc-input rounded text-white text-xs outline-none font-mono" />
                  <button
                    onClick={copyInviteUrl}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition flex items-center gap-1
                      ${copied ? 'bg-green-600 text-white' : 'bg-fc-accent hover:bg-indigo-500 text-white'}`}
                  >
                    <Copy size={12} />
                    {copied ? 'Copié !' : 'Copier'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => createInvite.mutate()}
                  disabled={createInvite.isPending}
                  className="px-3 py-1.5 bg-fc-hover hover:bg-fc-input text-fc-text rounded text-xs transition disabled:opacity-50"
                >
                  {createInvite.isPending ? 'Génération…' : 'Générer un lien'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── TAB: Online + All — avec barre de recherche ─── */}
        {(tab === 'online' || tab === 'all') && (
          <>
            {/* Barre de recherche */}
            <div className="relative max-w-sm mb-4">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fc-muted pointer-events-none" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Rechercher un ami..."
                className="w-full pl-8 pr-3 py-1.5 bg-fc-input rounded text-sm text-white outline-none focus:ring-2 focus:ring-fc-accent placeholder:text-fc-muted"
              />
            </div>

            <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">
              {tab === 'online' ? 'En ligne' : 'Tous les amis'} — {filteredAccepted.length}
            </div>

            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
              </div>
            ) : filteredAccepted.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-fc-muted gap-3">
                {tab === 'online'
                  ? <><WifiOff size={36} className="opacity-40" /><p className="text-sm">Aucun ami en ligne</p></>
                  : <><Wifi size={36} className="opacity-40" /><p className="text-sm">Aucun ami pour l'instant</p></>
                }
              </div>
            ) : (
              <div className="space-y-0.5">
                {filteredAccepted.map(f => renderFriendCard(f))}
              </div>
            )}
          </>
        )}

        {/* ── TAB: Pending ─── */}
        {tab === 'pending' && (
          <div>
            {/* Sous-tabs */}
            <div className="flex gap-1 mb-4">
              <button
                onClick={() => setPendingSubTab('received')}
                className={`px-3 py-1 rounded text-xs font-medium transition
                  ${pendingSubTab === 'received' ? 'bg-fc-hover text-white' : 'text-fc-muted hover:text-white'}`}
              >
                Reçues {pendingReceived.length > 0 && `(${pendingReceived.length})`}
              </button>
              <button
                onClick={() => setPendingSubTab('sent')}
                className={`px-3 py-1 rounded text-xs font-medium transition
                  ${pendingSubTab === 'sent' ? 'bg-fc-hover text-white' : 'text-fc-muted hover:text-white'}`}
              >
                Envoyées {pendingSent.length > 0 && `(${pendingSent.length})`}
              </button>
            </div>

            {isLoading ? (
              <div className="space-y-2">{[1, 2].map(i => <SkeletonCard key={i} />)}</div>
            ) : pendingSubTab === 'received' ? (
              pendingReceived.length === 0
                ? <p className="text-fc-muted text-sm py-8 text-center">Aucune demande reçue</p>
                : (
                  <div className="space-y-2">
                    {pendingReceived.map(f => (
                      <div key={f.id} className="flex items-center gap-3 p-3 bg-fc-channel rounded-lg hover:bg-fc-hover transition">
                        <AvatarWithStatus username={f.username} avatar={f.avatar} status={f.user_status} />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-white text-sm">{f.username}
                            <span className="text-fc-muted text-xs ml-0.5">#{f.discriminator}</span>
                          </div>
                          <div className="text-xs text-fc-muted flex items-center gap-1">
                            <Clock size={11} /> Demande reçue
                          </div>
                        </div>
                        <button onClick={() => accept.mutate(f.id)}
                          className="p-2 bg-fc-green/20 hover:bg-fc-green/30 text-fc-green rounded-full transition" title="Accepter">
                          <Check size={16} />
                        </button>
                        <button onClick={() => decline.mutate(f.id)}
                          className="p-2 bg-fc-red/20 hover:bg-fc-red/30 text-fc-red rounded-full transition" title="Refuser">
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )
            ) : (
              pendingSent.length === 0
                ? <p className="text-fc-muted text-sm py-8 text-center">Aucune demande envoyée</p>
                : (
                  <div className="space-y-2">
                    {pendingSent.map(f => (
                      <div key={f.id} className="flex items-center gap-3 p-3 bg-fc-channel rounded-lg hover:bg-fc-hover transition">
                        <AvatarWithStatus username={f.username} avatar={f.avatar} status={f.user_status} />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-white text-sm">{f.username}
                            <span className="text-fc-muted text-xs ml-0.5">#{f.discriminator}</span>
                          </div>
                          <div className="text-xs text-fc-yellow flex items-center gap-1">
                            <Clock size={11} /> En attente d'acceptation
                          </div>
                        </div>
                        <button onClick={() => decline.mutate(f.id)}
                          className="p-2 bg-fc-red/20 hover:bg-fc-red/30 text-fc-red rounded-full transition" title="Annuler">
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )
            )}
          </div>
        )}

        {/* ── TAB: Blocked ─── */}
        {tab === 'blocked' && (
          <div>
            <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3">
              Bloqués — {blocked.length}
            </div>
            {blocked.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-fc-muted gap-3">
                <MinusCircle size={36} className="opacity-40" />
                <p className="text-sm">Aucun utilisateur bloqué</p>
              </div>
            ) : (
              <div className="space-y-1">
                {blocked.map(b => (
                  <div key={b.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-fc-hover transition group">
                    <div className="w-10 h-10 rounded-full bg-fc-muted/30 flex items-center justify-center font-bold text-fc-muted overflow-hidden flex-shrink-0">
                      {b.avatar
                        ? <img src={b.avatar} alt="" className="w-full h-full object-cover opacity-50" />
                        : b.username.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-fc-muted text-sm line-through">
                        {b.username}<span className="text-xs ml-0.5">#{b.discriminator}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => unblockUser.mutate(b.id)}
                      className="opacity-0 group-hover:opacity-100 px-3 py-1 text-xs bg-fc-input hover:bg-fc-hover text-fc-text rounded transition"
                    >
                      Débloquer
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
