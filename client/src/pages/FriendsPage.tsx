import { useState, useMemo, useEffect } from 'react'
import { usePageTitle } from '../hooks/usePageTitle'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  UserPlus, MessageCircle, Check, X, Link, Copy, Search, LifeBuoy,
  MoreHorizontal, UserX, Shield, User, Wifi, WifiOff,
  Clock, MinusCircle, Upload, Menu, ChevronLeft,
  Phone, Video, PhoneIncoming, PhoneOutgoing, PhoneMissed,
} from 'lucide-react'
import api, { mediaUrl } from '../api/client'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { usePresence } from '../store/presence'
import { useFormatDate } from '../hooks/useFormatDate'
import ImportContactsModal from '../components/modals/ImportContactsModal'
import FriendSections, { FriendMenuExtras, FriendStatusLine } from '../components/friends/FriendSections'
import { useMobile } from '../contexts/MobileContext'
import { useT, t as tr, type Key } from '../i18n'

type FriendTab = 'online' | 'all' | 'pending' | 'blocked' | 'calls'
type PendingSubTab = 'received' | 'sent'

interface FriendRow {
  id: string
  /** Surnom privé donné à cet ami (friend_nicknames) */
  custom_nickname?: string | null
  friend_id: string
  status: 'accepted' | 'pending'
  direction?: 'received' | 'sent'
  username: string
  discriminator: string
  avatar: string | null
  user_status: string
  custom_status?: string | null
  is_favorite?: boolean
  birthday?: { month: number; day: number } | null
  activity_type?: string | null
  activity_name?: string | null
  in_call?: boolean
}

interface BlockedRow {
  id: string
  username: string
  discriminator: string
  avatar: string | null
}

interface SuggestionRow {
  id: string
  username: string
  discriminator: string
  avatar: string | null
  mutual_friends: number
  mutual_servers: number
}

interface CallRow {
  id: string
  call_type: 'voice' | 'video'
  status: 'ringing' | 'answered' | 'ended' | 'missed' | 'declined'
  direction: 'incoming' | 'outgoing'
  started_at: string
  duration_s: number | null
  dm_id: string | null
  other_user: { id: string; username: string; avatar: string | null }
}

const STATUS_COLOR: Record<string, string> = {
  online:    'bg-fc-green',
  idle:      'bg-fc-yellow',
  dnd:       'bg-fc-red',
  invisible: 'bg-fc-muted',
  offline:   'bg-fc-muted',
}

const STATUS_LABEL: Record<string, Key> = {
  online:  'presence.online',
  idle:    'presence.idle',
  dnd:     'presence.dnd',
  offline: 'presence.offline',
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
          ? <img src={mediaUrl(avatar)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
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
  const t = useT()
  usePageTitle(t('friends.title'))
  const { openSidebar } = useMobile()
  const { formatShort } = useFormatDate()
  const [tab, setTab] = useState<FriendTab>('all')
  const [pendingSubTab, setPendingSubTab] = useState<PendingSubTab>('received')

  const TAB_TITLES: Record<FriendTab, Key> = {
    online: 'friends.tabTitle.online',
    all: 'friends.allFriends',
    pending: 'friends.requests',
    blocked: 'friends.blocked',
    calls: 'friends.recentCalls',
  }
  useEffect(() => {
    const prefix = document.title.match(/^\(\d+\)\s*/)?.[0] ?? ''
    document.title = `${prefix}${tr(TAB_TITLES[tab])} | ForgeChat`
    return () => {
      const p = document.title.match(/^\(\d+\)\s*/)?.[0] ?? ''
      document.title = `${p}ForgeChat`
    }
  }, [tab])
  const [addTag, setAddTag] = useState('')
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [search, setSearch] = useState('')
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)
  const qc = useQueryClient()
  const nav = useNavigate()
  const presenceStatuses = usePresence(s => s.statuses)
  const getStatus = (id: string) => presenceStatuses[id] ?? 'offline'

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: friendsData, isLoading } = useQuery<{ friends: FriendRow[]; counts: Record<string, number> }>({
    queryKey: ['friends'],
    queryFn: () => api.get('/friends/v2?filter=all').then(r => r.data),
  })
  const friends: FriendRow[] = friendsData?.friends ?? []

  const { data: blocked = [] } = useQuery<BlockedRow[]>({
    queryKey: ['friends_blocked'],
    queryFn: () => api.get('/friends/blocked').then(r => r.data),
    enabled: tab === 'blocked',
  })

  const { data: calls = [], isLoading: callsLoading } = useQuery<CallRow[]>({
    queryKey: ['call_history'],
    queryFn: () => api.get('/friends/calls').then(r => r.data),
    enabled: tab === 'calls',
    staleTime: 30_000,
  })

  const { data: suggestions = [] } = useQuery<SuggestionRow[]>({
    queryKey: ['friend_suggestions'],
    queryFn: () => api.get('/friends/suggestions').then(r => r.data),
    enabled: tab === 'pending',
    staleTime: 60_000,
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
      const live = presenceStatuses[f.friend_id] ?? f.user_status ?? 'offline'
      return live === 'online'
    }),
    [accepted, presenceStatuses]
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

  // Tout l'annuaire de l'instance, filtré pendant la frappe (le #tag n'est pas nécessaire).
  const addQuery = addTag.trim().toLowerCase().split('#')[0]
  const shownSuggestions = addQuery ? suggestions.filter(s => s.username.toLowerCase().includes(addQuery)) : suggestions

  // ── Mutations ──────────────────────────────────────────────────────────────
  const createInvite = useMutation({
    mutationFn: () => api.post('/friends/invite').then(r => r.data),
    onSuccess: (data: { url: string }) => setInviteUrl(data.url),
    onError: () => toast.error(t('friends.linkError')),
  })

  const sendRequest = useMutation({
    mutationFn: (tag: string) => api.post('/friends/by-name', { name: tag }).then(r => r.data as { outcome?: string }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['friends'] })
      qc.invalidateQueries({ queryKey: ['friend_suggestions'] })
      setAddTag('')
      toast.success(t(data?.outcome === 'accepted' ? 'friends.nowFriends' : 'friends.requestSent'))
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { error?: string } } }
      toast.error(err.response?.data?.error ?? t('friends.userNotFound'))
    },
  })

  const accept = useMutation({
    mutationFn: (id: string) => api.post(`/friends/${id}/accept`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
    onError: () => toast.error(t('friends.acceptError')),
  })

  const decline = useMutation({
    mutationFn: (id: string) => api.post(`/friends/${id}/decline`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
    onError: () => toast.error(t('friends.declineError')),
  })

  // Annuler une demande qu'on a SOI-MÊME envoyée -- endpoint distinct de
  // /decline (qui ne supprime que côté destinataire : DELETE ... WHERE
  // friend_id=$claims.sub, jamais vrai pour l'expéditeur, donc /decline
  // renvoyait 200 sans jamais rien supprimer si on l'utilisait ici).
  const cancelRequest = useMutation({
    mutationFn: (id: string) => api.delete(`/friends/${id}/cancel`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['friends'] })
      toast.success(t('friends.requestCancelled'))
    },
    onError: () => toast.error(t('friends.cancelError')),
  })

  const remove = useMutation({
    mutationFn: (friendId: string) => api.delete(`/friends/${friendId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['friends'] })
      toast.success(t('friends.removed'))
    },
    onError: () => toast.error(t('saved.removeError')),
  })

  const blockUser = useMutation({
    mutationFn: (userId: string) => api.post(`/friends/block/${userId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['friends'] })
      qc.invalidateQueries({ queryKey: ['friends_blocked'] })
      toast.success(t('friends.blockedToast'))
    },
    onError: () => toast.error(t('friends.blockError')),
  })

  const unblockUser = useMutation({
    mutationFn: (userId: string) => api.delete(`/friends/block/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends_blocked'] }),
    onError: () => toast.error(t('friends.unblockError')),
  })

  const openDm = async (userId: string, support = false) => {
    try {
      const { data } = await api.post(`/dms/${userId}`)
      nav(`/dms/${data.dm_id}${support ? '?support=1' : ''}`)
    } catch {
      toast.error(t('friends.dmError'))
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
  const TabBtn = ({ id, label, count }: { id: FriendTab; label: string; count?: number }) => (
    <button
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={`px-3 py-1.5 rounded text-sm font-medium transition
        ${tab === id
          ? 'bg-fc-hover text-white'
          : 'text-fc-muted hover:text-white hover:bg-fc-hover/50'}`}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span aria-label={t('friends.pendingCount', { n: count })} className="ml-1.5 bg-fc-red text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
          <span aria-hidden>{count}</span>
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
            {f.custom_nickname || f.username}
            <span className="text-fc-muted font-normal text-xs ml-0.5">
              #{f.discriminator}
            </span>
          </div>
          <FriendStatusLine friend={f} fallback={t(STATUS_LABEL[live] ?? 'presence.offline')} />
        </div>

        {/* Actions (visibles au hover) */}
        <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition">
          <button
            onClick={e => { e.stopPropagation(); openDm(f.friend_id) }}
            title={t('friends.message')}
            aria-label={t('friends.message')}
            className="p-1.5 min-w-[36px] min-h-[36px] flex items-center justify-center text-fc-muted hover:text-white rounded hover:bg-fc-input transition"
          >
            <MessageCircle size={16} />
          </button>

          <div className="relative">
            <button
              onClick={e => { e.stopPropagation(); setMenuOpen(isOpen ? null : f.id) }}
              title={t('friends.more')}
              aria-label={t('friends.more')}
              className="p-1.5 text-fc-muted hover:text-white rounded hover:bg-fc-input transition"
            >
              <MoreHorizontal size={16} />
            </button>

            {isOpen && (
              <div className="absolute right-0 top-8 z-20 bg-fc-bg border border-fc-hover rounded-lg shadow-xl py-1 w-52 max-h-80 overflow-y-auto"
                onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => { nav(`/users/${f.friend_id}`); setMenuOpen(null) }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-fc-text hover:bg-fc-hover transition"
                >
                  <User size={14} /> {t('friends.profile')}
                </button>
                <FriendMenuExtras friend={f} />
                <button
                  onClick={() => { openDm(f.friend_id, true); setMenuOpen(null) }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-fc-text hover:bg-fc-hover transition"
                >
                  <LifeBuoy size={14} /> {t('rs.button')}
                </button>
                <button
                  onClick={() => { remove.mutate(f.friend_id); setMenuOpen(null) }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-fc-red hover:bg-fc-hover transition"
                >
                  <UserX size={14} /> {t('common.delete')}
                </button>
                <button
                  onClick={() => { blockUser.mutate(f.friend_id); setMenuOpen(null) }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-fc-red hover:bg-fc-hover transition"
                >
                  <Shield size={14} /> {t('friends.block')}
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
    <>
    <div className="flex flex-col h-full" onClick={() => menuOpen && setMenuOpen(null)}>
      {/* Header — rangée 1 : titre + actions */}
      <div className="flex items-center gap-2 px-3 md:px-4 py-2.5 border-b border-fc-bg shadow-sm flex-shrink-0">
        <button
          className="md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition flex-shrink-0"
          onClick={openSidebar}
          aria-label={t('common.back')}
        >
          <ChevronLeft size={20} />
        </button>
        <span className="font-semibold text-white flex-shrink-0">{t('friends.title')}</span>
        {/* Tabs scrollables horizontalement */}
        <div className="flex-1 overflow-x-auto overflow-y-hidden no-scrollbar">
          <div role="tablist" aria-label={t('friends.filter')} className="flex items-center gap-1 min-w-max px-1">
            <TabBtn id="online" label={t('presence.online')} count={online.length} />
            <TabBtn id="all" label={t('friends.tab.all')} />
            <TabBtn id="pending" label={t('friends.tab.pending')} count={pendingCount} />
            <TabBtn id="blocked" label={t('friends.blocked')} />
            <TabBtn id="calls" label={t('friends.tab.calls')} />
          </div>
        </div>
        {/* Actions — icône sur mobile, texte sur desktop */}
        <button
          onClick={() => setTab('pending')}
          className="flex-shrink-0 p-1.5 md:px-3 md:py-1.5 rounded text-sm font-medium bg-fc-accent hover:bg-indigo-500 text-white transition flex items-center gap-1"
          title={t('friends.add')}
          aria-label={t('friends.add')}
        >
          <UserPlus size={16} />
          <span className="hidden md:inline">{t('chset.add')}</span>
        </button>
        <button
          onClick={() => setShowImport(true)}
          className="flex-shrink-0 hidden md:flex px-3 py-1.5 rounded text-sm font-medium bg-fc-hover hover:bg-fc-input text-fc-text hover:text-white transition items-center gap-1.5"
          title={t('friends.importTitle')}
        >
          <Upload size={14} />
          {t('friends.importCsv')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain p-4">

        {/* ── TAB: Ajouter (form dans En attente) ─── */}
        {tab === 'pending' && (
          <div className="max-w-2xl mb-6 p-4 bg-fc-channel rounded-xl border border-fc-hover">
            <h3 className="font-semibold text-white mb-1 flex items-center gap-2">
              <UserPlus size={16} className="text-fc-accent" />
              {t('friends.add')}
            </h3>
            <p className="text-fc-muted text-xs mb-3">
              {t('friends.enterTag')} <span className="text-fc-text font-mono">username#0000</span>
            </p>
            <div className="flex gap-2">
              <input
                value={addTag}
                onChange={e => setAddTag(e.target.value)}
                placeholder="pseudo  ·  pseudo#0000"
                aria-label={t('friends.add')}
                enterKeyHint="send" autoCapitalize="none" autoCorrect="off"
                className="flex-1 px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm font-mono"
                onKeyDown={e => e.key === 'Enter' && addTag.trim() && sendRequest.mutate(addTag.trim())}
              />
              <button
                onClick={() => addTag.trim() && sendRequest.mutate(addTag.trim())}
                disabled={!addTag.trim() || sendRequest.isPending}
                className="px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition disabled:opacity-40"
              >
                {sendRequest.isPending ? '…' : t('friends.send')}
              </button>
            </div>

            {/* Lien d'invitation */}
            <div className="mt-4 pt-4 border-t border-fc-hover">
              <p className="text-xs text-fc-muted mb-2 flex items-center gap-1.5">
                <Link size={12} className="text-fc-accent" />
                {t('friends.inviteLink')}
              </p>
              {inviteUrl ? (
                <div className="flex gap-2">
                  <input readOnly value={inviteUrl} aria-label={t('invite.link')}
                    className="flex-1 px-2 py-1.5 bg-fc-input rounded text-white text-xs outline-none font-mono streamer-invite" />
                  <button
                    onClick={copyInviteUrl}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition flex items-center gap-1
                      ${copied ? 'bg-green-600 text-white' : 'bg-fc-accent hover:bg-indigo-500 text-white'}`}
                  >
                    <Copy size={12} />
                    {copied ? t('feeds.copied') : t('feeds.copy')}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => createInvite.mutate()}
                  disabled={createInvite.isPending}
                  className="px-3 py-1.5 bg-fc-hover hover:bg-fc-input text-fc-text rounded text-xs transition disabled:opacity-50"
                >
                  {createInvite.isPending ? t('friends.generating') : t('friends.generateLink')}
                </button>
              )}
            </div>

            {/* Suggestions — amis d'amis et serveurs en commun */}
            {(suggestions.length > 0 || addTag.trim() !== '') && (
              <div className="mt-4 pt-4 border-t border-fc-hover">
                <p className="text-xs text-fc-muted mb-2 flex items-center gap-1.5">
                  <UserPlus size={12} className="text-fc-accent" />
                  {t('friends.suggestions')}
                </p>
                <div className="space-y-1 max-h-80 overflow-y-auto">
                  {shownSuggestions.length === 0 && <p className="text-xs text-fc-muted px-2">{t('friends.noMatch')}</p>}
                  {shownSuggestions.map(s => (
                    <div key={s.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-fc-hover transition group">
                      <div className="w-8 h-8 rounded-full bg-fc-accent flex items-center justify-center text-xs font-bold text-white overflow-hidden flex-shrink-0">
                        {s.avatar
                          ? <img src={mediaUrl(s.avatar)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                          : s.username.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-white truncate">
                          {s.username}<span className="text-fc-muted text-xs ml-0.5">#{s.discriminator}</span>
                        </div>
                        <div className="text-xs text-fc-muted truncate">
                          {[
                            s.mutual_friends > 0 && t(s.mutual_friends > 1 ? 'friends.mutualFriends.other' : 'friends.mutualFriends.one', { n: s.mutual_friends }),
                            s.mutual_servers > 0 && t(s.mutual_servers > 1 ? 'friends.mutualServers.other' : 'friends.mutualServers.one', { n: s.mutual_servers }),
                          ].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <button
                        onClick={() => sendRequest.mutate(`${s.username}#${s.discriminator}`)}
                        disabled={sendRequest.isPending}
                        className="flex-shrink-0 px-2.5 py-1 text-xs bg-fc-accent hover:bg-indigo-500 text-white rounded transition disabled:opacity-40"
                      >
                        {t('chset.add')}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
                placeholder={t('friends.searchPh')}
                aria-label={t('friends.search')}
                inputMode="search" autoComplete="off"
                className="w-full pl-8 pr-3 py-1.5 bg-fc-input rounded text-sm text-white outline-none focus:ring-2 focus:ring-fc-accent placeholder:text-fc-muted"
              />
            </div>

            <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">
              {tab === 'online' ? t('presence.online') : t('friends.allFriends')} — {filteredAccepted.length}
            </div>

            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
              </div>
            ) : filteredAccepted.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-fc-muted gap-3">
                {tab === 'online'
                  ? <><WifiOff size={36} className="opacity-40" /><p className="text-sm">{t('friends.noneOnline')}</p></>
                  : <><Wifi size={36} className="opacity-40" /><p className="text-sm">{t('friends.none')}</p></>
                }
              </div>
            ) : (
              <FriendSections friends={filteredAccepted} all={accepted} renderCard={renderFriendCard} />
            )}
          </>
        )}

        {/* ── TAB: Pending ─── */}
        {tab === 'pending' && (
          <div>
            {/* Sous-tabs */}
            <div role="group" aria-label={t('friends.requests')} className="flex gap-1 mb-4">
              <button
                onClick={() => setPendingSubTab('received')}
                aria-pressed={pendingSubTab === 'received'}
                className={`px-3 py-1 rounded text-xs font-medium transition
                  ${pendingSubTab === 'received' ? 'bg-fc-hover text-white' : 'text-fc-muted hover:text-white'}`}
              >
                {t('friends.received')} {pendingReceived.length > 0 && `(${pendingReceived.length})`}
              </button>
              <button
                onClick={() => setPendingSubTab('sent')}
                aria-pressed={pendingSubTab === 'sent'}
                className={`px-3 py-1 rounded text-xs font-medium transition
                  ${pendingSubTab === 'sent' ? 'bg-fc-hover text-white' : 'text-fc-muted hover:text-white'}`}
              >
                {t('friends.sent')} {pendingSent.length > 0 && `(${pendingSent.length})`}
              </button>
            </div>

            {isLoading ? (
              <div className="space-y-2">{[1, 2].map(i => <SkeletonCard key={i} />)}</div>
            ) : pendingSubTab === 'received' ? (
              pendingReceived.length === 0
                ? <p className="text-fc-muted text-sm py-8 text-center">{t('friends.noneReceived')}</p>
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
                            <Clock size={11} /> {t('friends.requestReceived')}
                          </div>
                        </div>
                        <button onClick={() => accept.mutate(f.id)}
                          aria-label={t('friends.acceptName', { name: f.username })}
                          title={t('friends.accept')}
                          className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center bg-fc-green/20 hover:bg-fc-green/30 text-fc-green rounded-full transition">
                          <Check size={16} aria-hidden />
                        </button>
                        <button onClick={() => decline.mutate(f.id)}
                          aria-label={t('friends.declineName', { name: f.username })}
                          title={t('friends.decline')}
                          className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center bg-fc-red/20 hover:bg-fc-red/30 text-fc-red rounded-full transition">
                          <X size={16} aria-hidden />
                        </button>
                      </div>
                    ))}
                  </div>
                )
            ) : (
              pendingSent.length === 0
                ? <p className="text-fc-muted text-sm py-8 text-center">{t('friends.noneSent')}</p>
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
                            <Clock size={11} /> {t('friends.awaiting')}
                          </div>
                        </div>
                        <button onClick={() => cancelRequest.mutate(f.id)}
                          aria-label={t('friends.cancelName', { name: f.username })}
                          title={t('common.cancel')}
                          className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center bg-fc-red/20 hover:bg-fc-red/30 text-fc-red rounded-full transition">
                          <X size={16} aria-hidden />
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
              {t('friends.blocked')} — {blocked.length}
            </div>
            {blocked.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-fc-muted gap-3">
                <MinusCircle size={36} className="opacity-40" />
                <p className="text-sm">{t('friends.noneBlocked')}</p>
              </div>
            ) : (
              <div className="space-y-1">
                {blocked.map(b => (
                  <div key={b.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-fc-hover transition group">
                    <div className="w-10 h-10 rounded-full bg-fc-muted/30 flex items-center justify-center font-bold text-fc-muted overflow-hidden flex-shrink-0">
                      {b.avatar
                        ? <img src={mediaUrl(b.avatar)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover opacity-50" />
                        : b.username.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-fc-muted text-sm line-through">
                        {b.username}<span className="text-xs ml-0.5">#{b.discriminator}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => unblockUser.mutate(b.id)}
                      className="opacity-100 md:opacity-0 md:group-hover:opacity-100 px-3 py-1 text-xs bg-fc-input hover:bg-fc-hover text-fc-text rounded transition"
                    >
                      {t('friends.unblock')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {/* ── TAB: Appels (historique) ─── */}
        {tab === 'calls' && (
          <div>
            <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3">
              {t('friends.recentCalls')} — {calls.length}
            </div>
            {callsLoading ? (
              <div className="flex justify-center py-16">
                <div className="w-6 h-6 border-2 border-fc-accent border-t-transparent rounded-full animate-spin" />
              </div>
            ) : calls.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-fc-muted gap-3">
                <Phone size={36} className="opacity-40" />
                <p className="text-sm">{t('friends.noCalls')}</p>
                <p className="text-xs opacity-70">{t('friends.noCallsHint')}</p>
              </div>
            ) : (
              <div className="space-y-1">
                {calls.map(c => {
                  const missed = c.status === 'missed' || c.status === 'declined'
                  const statusLabel = c.status === 'ended'
                    ? (c.duration_s != null ? `${Math.floor(c.duration_s / 60)}:${String(c.duration_s % 60).padStart(2, '0')}` : t('friends.call.ended'))
                    : c.status === 'missed' ? t('friends.call.missed')
                    : c.status === 'declined' ? t('friends.call.declined')
                    : t('friends.call.ongoing')
                  const DirIcon = missed ? PhoneMissed : c.direction === 'outgoing' ? PhoneOutgoing : PhoneIncoming
                  return (
                    <button
                      key={c.id}
                      onClick={() => c.dm_id && nav(`/dms/${c.dm_id}`)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-fc-hover transition w-full text-left"
                      title={c.dm_id ? t('friends.openDm') : undefined}
                    >
                      <div className="w-10 h-10 rounded-full bg-fc-accent flex items-center justify-center font-bold text-white overflow-hidden flex-shrink-0">
                        {c.other_user.avatar
                          ? <img src={mediaUrl(c.other_user.avatar)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                          : c.other_user.username.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-white text-sm truncate">{c.other_user.username}</div>
                        <div className={`flex items-center gap-1.5 text-xs ${missed ? 'text-fc-red' : 'text-fc-muted'}`}>
                          <DirIcon size={12} aria-hidden />
                          {c.direction === 'outgoing' ? t('friends.call.outgoing') : t('friends.call.incoming')} · {statusLabel}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 text-fc-muted">
                        {c.call_type === 'video' ? <Video size={15} aria-label={t('friends.call.video')} /> : <Phone size={15} aria-label={t('friends.call.voice')} />}
                        <span className="text-xs">{formatShort(c.started_at)}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    {showImport && <ImportContactsModal onClose={() => setShowImport(false)} />}
    </>
  )
}
