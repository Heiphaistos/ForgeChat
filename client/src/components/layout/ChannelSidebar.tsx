import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown, Hash, Plus, Volume2, UserPlus, Settings,
  Video, Megaphone, MessagesSquare, Radio, ChevronRight,
  Mic, MicOff, Monitor, Clock, Lock, PlusCircle, Timer,
  Users, X, GripVertical, Shield, Archive, EyeOff,
} from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import { useContextMenu } from '../ui/ContextMenu'
import ServerBoostBanner from '../server/ServerBoostBanner'
import { usePresence } from '../../store/presence'
import { useUnread } from '../../store/unread'
import { useVoice } from '../../store/voice'
import { useWs } from '../../store/ws'
import CreateChannelModal from '../modals/CreateChannelModal'
import InviteModal from '../modals/InviteModal'
import ServerSettingsModal from '../modals/ServerSettingsModal'
import ChannelSettingsModal from '../modals/ChannelSettingsModal'
import VoicePasswordPrompt from '../modals/VoicePasswordPrompt'
import toast from 'react-hot-toast'

// Couleurs de présence enrichies (online/idle/dnd/invisible/offline)
const PRESENCE_COLOR: Record<string, string> = {
  online: 'bg-fc-green',
  idle: 'bg-fc-yellow',
  dnd: 'bg-fc-red',
  invisible: 'bg-fc-muted',
  offline: 'bg-fc-muted',
}

// Modal léger pour créer un groupe DM
function CreateGroupModal({ onClose }: { onClose: () => void }) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<{ id: string; username: string }[]>([])
  const qc = useQueryClient()
  const nav = useNavigate()

  const { data: friends = [] } = useQuery({
    queryKey: ['friends-dm-search', search],
    queryFn: () => api.get('/friends', { params: { q: search } }).then(r => r.data),
    staleTime: 10_000,
  })

  const create = useMutation({
    mutationFn: () =>
      api.post('/dms/group', { user_ids: selected.map(u => u.id) }).then(r => r.data),
    onSuccess: (dm: any) => {
      qc.invalidateQueries({ queryKey: ['dms'] })
      nav(`/dms/groups/${dm.dm_id ?? dm.id}`)
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur création groupe'),
  })

  const toggle = (u: { id: string; username: string }) => {
    setSelected(prev =>
      prev.find(x => x.id === u.id)
        ? prev.filter(x => x.id !== u.id)
        : prev.length < 10 ? [...prev, u] : prev
    )
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-fc-channel rounded-xl w-80 shadow-2xl p-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-white text-sm">Nouveau groupe (max 10)</h2>
          <button onClick={onClose} className="text-fc-muted hover:text-white"><X size={16} /></button>
        </div>

        <input
          className="w-full bg-fc-input text-sm text-white rounded-lg px-3 py-2 mb-3 outline-none placeholder:text-fc-muted"
          placeholder="Chercher des amis..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
        />

        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {selected.map(u => (
              <span
                key={u.id}
                className="flex items-center gap-1 bg-fc-accent/20 text-fc-accent text-xs px-2 py-0.5 rounded-full"
              >
                {u.username}
                <button onClick={() => toggle(u)}><X size={10} /></button>
              </span>
            ))}
          </div>
        )}

        <div className="max-h-40 overflow-y-auto space-y-0.5 mb-3">
          {(friends as any[]).map((f: any) => {
            const uid: string = f.id ?? f.user_id
            const uname: string = f.username
            const isSelected = !!selected.find(x => x.id === uid)
            return (
              <button
                key={uid}
                onClick={() => toggle({ id: uid, username: uname })}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded transition text-left ${
                  isSelected
                    ? 'bg-fc-accent/20 text-white'
                    : 'hover:bg-fc-hover text-fc-muted hover:text-white'
                }`}
              >
                <div className="w-7 h-7 rounded-full bg-fc-accent flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                  {uname.charAt(0).toUpperCase()}
                </div>
                <span className="text-sm">{uname}</span>
              </button>
            )
          })}
          {(friends as any[]).length === 0 && (
            <p className="text-xs text-fc-muted text-center py-2">Aucun ami trouvé</p>
          )}
        </div>

        <button
          onClick={() => create.mutate()}
          disabled={selected.length < 2 || create.isPending}
          className="w-full py-2 bg-fc-accent hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {create.isPending ? 'Création...' : `Créer (${selected.length} membres)`}
        </button>
      </div>
    </div>
  )
}

function BoostButton({ serverId }: { serverId: string }) {
  const qc = useQueryClient()
  const boost = useMutation({
    mutationFn: () => api.post(`/servers/${serverId}/boost`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['server', serverId] })
      qc.invalidateQueries({ queryKey: ['channels', serverId] })
    },
    onError: () => toast.error('Impossible de booster'),
  })
  return (
    <button
      onClick={() => boost.mutate()}
      disabled={boost.isPending}
      className="mx-2 mb-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg
        text-xs font-semibold text-purple-300 border border-purple-500/30 bg-purple-500/10
        hover:bg-purple-500/20 hover:border-purple-500/60 transition disabled:opacity-50"
    >
      ⚡ Booster le serveur
    </button>
  )
}

function ChannelIcon({ type, size = 16 }: { type: string; size?: number }) {
  switch (type) {
    case 'voice': return <Volume2 size={size} className="flex-shrink-0" />
    case 'video': return <Video size={size} className="flex-shrink-0" />
    case 'announcement': return <Megaphone size={size} className="flex-shrink-0" />
    case 'forum': return <MessagesSquare size={size} className="flex-shrink-0" />
    case 'stage': return <Radio size={size} className="flex-shrink-0" />
    default: return <Hash size={size} className="flex-shrink-0" />
  }
}

const UNCATEGORIZED_KEY = '__uncategorized__'

export default function ChannelSidebar() {
  const { serverId, channelId } = useParams()
  const nav = useNavigate()
  const [showCreateChannel, setShowCreateChannel] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      const stored = localStorage.getItem('fc_collapsed_cats')
      return stored ? JSON.parse(stored) : {}
    } catch {
      return {}
    }
  })
  const [channelSettings, setChannelSettings] = useState<any | null>(null)
  const [passwordPrompt, setPasswordPrompt] = useState<{ channel: any } | null>(null)
  const [draggedChannelId, setDraggedChannelId] = useState<string | null>(null)
  const [dragOverChannelId, setDragOverChannelId] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const qc = useQueryClient()
  const getStatus = usePresence(s => s.getStatus)
  const unreadCounts = useUnread(s => s.counts)

  const { data } = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => api.get(`/servers/${serverId}`).then(r => r.data),
    enabled: !!serverId,
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', serverId],
    queryFn: () => api.get(`/servers/${serverId}/categories`).then(r => r.data),
    enabled: !!serverId,
  })

  const ctxMenu = useContextMenu()

  const roomParticipants = useVoice(s => s.roomParticipants)
  const activeStreams = useVoice(s => s.activeStreams)
  const voiceChannelId = useVoice(s => s.channelId)
  const voiceJoin = useVoice(s => s.join)
  const { on: wsOn } = useWs()

  // Écouter les erreurs de join vocal
  useEffect(() => {
    return wsOn('VOICE_JOIN_ERROR', (d: any) => {
      if (d.reason === 'channel_full') {
        toast.error(`Canal plein (${d.current}/${d.limit} places)`)
      } else if (d.reason === 'wrong_password') {
        toast.error('Mot de passe incorrect')
      }
    })
  }, [])

  const { data: dms = [] } = useQuery({
    queryKey: ['dms'],
    queryFn: () => api.get('/dms').then(r => r.data),
    enabled: !serverId,
  })

  if (!serverId) {
    // Séparer groupes et DMs individuels
    const groupDms = (dms as any[]).filter(d => d.is_group)
    const individualDms = (dms as any[]).filter(d => !d.is_group)

    return (
      <div className="flex-1 overflow-y-auto p-2">
        {/* En-tête + bouton créer groupe */}
        <div className="flex items-center justify-between px-2 py-2">
          <span className="text-xs font-semibold text-fc-muted uppercase tracking-wide">
            Messages directs
          </span>
          <button
            onClick={() => setShowCreateGroup(true)}
            className="text-fc-muted hover:text-white transition"
            title="Nouveau groupe"
          >
            <Plus size={15} />
          </button>
        </div>

        {/* Groupes DM */}
        {groupDms.length > 0 && (
          <>
            <div className="px-2 py-1 text-[10px] font-semibold text-fc-muted uppercase tracking-wide">
              Groupes
            </div>
            {groupDms.map((dm: any) => {
              const unread = unreadCounts[dm.id] ?? 0
              return (
                <button
                  key={dm.id}
                  onClick={() => nav(`/dms/groups/${dm.id}`)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"
                >
                  <div className="relative flex-shrink-0">
                    <div className="w-8 h-8 rounded-full bg-fc-hover flex items-center justify-center text-fc-muted">
                      <Users size={16} />
                    </div>
                  </div>
                  <div className="min-w-0 text-left flex-1">
                    <div className={`text-sm truncate ${unread > 0 ? 'font-semibold text-white' : 'font-medium text-fc-text'}`}>
                      {dm.name ?? dm.username ?? 'Groupe'}
                    </div>
                    <div className="text-xs text-fc-muted">{dm.member_count ?? '?'} membres</div>
                  </div>
                  {unread > 0 && (
                    <span className="flex-shrink-0 min-w-[18px] h-[18px] bg-fc-red text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                      {unread > 99 ? '99+' : unread}
                    </span>
                  )}
                </button>
              )
            })}
          </>
        )}

        {/* DMs individuels */}
        {groupDms.length > 0 && individualDms.length > 0 && (
          <div className="px-2 py-1 text-[10px] font-semibold text-fc-muted uppercase tracking-wide mt-1">
            Directs
          </div>
        )}
        {individualDms.map((dm: any) => {
          const liveStatus = getStatus(dm.other_user_id) || dm.status || 'offline'
          const statusKey = liveStatus in PRESENCE_COLOR ? liveStatus : 'offline'
          const unread = unreadCounts[dm.id] ?? 0
          return (
            <button
              key={dm.id}
              onClick={() => nav(`/dms/${dm.id}`)}
              className="flex items-center gap-2 w-full px-2 py-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"
            >
              <div className="relative flex-shrink-0">
                <div className="w-8 h-8 rounded-full bg-fc-accent flex items-center justify-center text-sm font-bold text-white overflow-hidden">
                  {dm.avatar
                    ? <img src={dm.avatar} alt="" className="w-full h-full object-cover" />
                    : dm.username.charAt(0).toUpperCase()}
                </div>
                {/* Indicateur de présence coloré (vert/jaune/rouge/gris) */}
                <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-fc-channel ${PRESENCE_COLOR[statusKey]}`} />
              </div>
              <div className="min-w-0 text-left flex-1">
                <div className={`text-sm truncate ${unread > 0 ? 'font-semibold text-white' : 'font-medium text-fc-text'}`}>
                  {dm.username}
                </div>
                <div className={`text-xs ${statusKey === 'online' ? 'text-fc-green' : statusKey === 'idle' ? 'text-fc-yellow' : statusKey === 'dnd' ? 'text-fc-red' : 'text-fc-muted'}`}>
                  {statusKey === 'online' ? 'En ligne'
                    : statusKey === 'idle' ? 'Absent'
                    : statusKey === 'dnd' ? 'Ne pas déranger'
                    : 'Hors ligne'}
                </div>
              </div>
              {/* Badge non-lus */}
              {unread > 0 && (
                <span className="flex-shrink-0 min-w-[18px] h-[18px] bg-fc-red text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </button>
          )
        })}

        {/* Modal créer groupe */}
        {showCreateGroup && (
          <CreateGroupModal onClose={() => setShowCreateGroup(false)} />
        )}
      </div>
    )
  }

  const server = data?.server
  const allChannels: any[] = data?.channels ?? []
  const channels: any[] = allChannels.filter((c: any) => !c.archived && !c.hidden)
  const hiddenChannels: any[] = allChannels.filter((c: any) => c.hidden && !c.archived)
  const archivedChannels: any[] = allChannels.filter((c: any) => c.archived)

  // Déterminer si l'utilisateur courant est owner ou admin
  const isOwnerOrAdmin = !!server && (
    server.owner_id === data?.current_user_id ||
    (data?.member_roles ?? []).some((r: any) => r.permissions?.includes('MANAGE_CHANNELS') || r.is_admin)
  )

  // ── Drag & Drop channels ──────────────────────────────────
  const reorderChannels = useMutation({
    mutationFn: (channel_ids: string[]) =>
      api.patch(`/servers/${serverId}/channels/reorder`, { channel_ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server', serverId] }),
    onError: () => toast.error('Erreur lors du déplacement'),
  })

  const archiveChannel = useMutation({
    mutationFn: (chId: string) => api.patch(`/servers/${serverId}/channels/${chId}/archive`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server', serverId] }),
  })

  const hideChannelMutation = useMutation({
    mutationFn: (id: string) => api.post(`/channels/${id}/hide`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server', serverId] }),
  })

  const unhideChannelMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/channels/${id}/hide`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server', serverId] }),
  })

  const moveChannel = useMutation({
    mutationFn: ({ channelId, categoryId }: { channelId: string; categoryId: string | null }) =>
      api.patch(`/channels/${channelId}/move`, { category_id: categoryId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server', serverId] }),
    onError: () => toast.error('Erreur lors du déplacement du canal'),
  })

  const handleChannelDragStart = useCallback((e: React.DragEvent, channelId: string) => {
    setDraggedChannelId(channelId)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleChannelDragOver = useCallback((e: React.DragEvent, channelId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverChannelId(channelId)
  }, [])

  const handleChannelDrop = useCallback((e: React.DragEvent, targetChannelId: string, groupChannels: any[], categoryKey = '') => {
    e.preventDefault()
    if (!draggedChannelId || draggedChannelId === targetChannelId) {
      setDraggedChannelId(null)
      setDragOverChannelId(null)
      return
    }
    const draggedIdx = groupChannels.findIndex((c: any) => c.id === draggedChannelId)
    const targetIdx = groupChannels.findIndex((c: any) => c.id === targetChannelId)
    if (draggedIdx === -1 && categoryKey) {
      const newCategoryId = categoryKey === UNCATEGORIZED_KEY ? null : categoryKey
      moveChannel.mutate({ channelId: draggedChannelId, categoryId: newCategoryId })
      setDraggedChannelId(null)
      setDragOverChannelId(null)
      return
    }
    if (draggedIdx === -1 || targetIdx === -1) {
      setDraggedChannelId(null)
      setDragOverChannelId(null)
      return
    }
    const reordered = [...groupChannels]
    const [removed] = reordered.splice(draggedIdx, 1)
    reordered.splice(targetIdx, 0, removed)
    setDraggedChannelId(null)
    setDragOverChannelId(null)
    reorderChannels.mutate(reordered.map((c: any) => c.id))
  }, [draggedChannelId, reorderChannels, moveChannel])

  const handleChannelDragEnd = useCallback(() => {
    setDraggedChannelId(null)
    setDragOverChannelId(null)
  }, [])

  const toggleGroup = (key: string) => {
    setCollapsed(prev => {
      const next = { ...prev, [key]: !prev[key] }
      try { localStorage.setItem('fc_collapsed_cats', JSON.stringify(next)) } catch {}
      return next
    })
  }

  // Construire les groupes dynamiques basés sur les catégories DB
  // Chaque catégorie regroupe ses canaux ; les canaux sans category_id vont dans "sans catégorie"
  const categoryGroups: Array<{ key: string; label: string; channels: any[] }> = []

  // Canaux rattachés à une catégorie connue
  for (const cat of categories) {
    const catChannels = channels.filter((c: any) => c.category_id === cat.id)
    if (catChannels.length > 0) {
      categoryGroups.push({ key: cat.id, label: cat.name, channels: catChannels })
    }
  }

  // Canaux sans catégorie (category_id null ou catégorie inconnue)
  const knownCatIds = new Set(categories.map((c: any) => c.id))
  const uncategorized = channels.filter(
    (c: any) => !c.category_id || !knownCatIds.has(c.category_id)
  )

  // Si pas de catégories du tout, on fallback sur l'ancien groupement par type
  // pour que les serveurs sans catégories affichent quand même leurs canaux
  if (categories.length === 0 && channels.length > 0) {
    const textChannels = channels.filter((c: any) => ['text', 'announcement', 'forum'].includes(c.type))
    const voiceChannels = channels.filter((c: any) => ['voice', 'video', 'stage'].includes(c.type))
    if (textChannels.length > 0) categoryGroups.push({ key: 'texte', label: 'Texte', channels: textChannels })
    if (voiceChannels.length > 0) categoryGroups.push({ key: 'vocal', label: 'Vocal & Vidéo', channels: voiceChannels })
  } else if (uncategorized.length > 0) {
    categoryGroups.push({ key: UNCATEGORIZED_KEY, label: 'Sans catégorie', channels: uncategorized })
  }

  const handleVoiceChannelClick = (ch: any) => {
    if (ch.voice_password_hash) {
      // Canal protégé — afficher le prompt password
      setPasswordPrompt({ channel: ch })
    } else {
      nav(`/servers/${serverId}/channels/${ch.id}`)
    }
  }

  const renderChannel = (ch: any, groupChannels: any[], extraClass = '', categoryKey = '') => {
    const isVoiceCh = ch.type === 'voice' || ch.type === 'video' || ch.type === 'stage'
    const participants = isVoiceCh ? (roomParticipants[ch.id] ?? []) : []
    const isMeConnected = voiceChannelId === ch.id
    const hasPassword = !!ch.voice_password_hash
    const userLimit = ch.user_limit ?? 0
    const slowmodeDelay = ch.slowmode_delay ?? 0
    const isAutoCreate = !!ch.is_auto_create
    const isTemporary = !!ch.is_temporary
    // Streams actifs dans ce canal vocal
    const channelStreams = isVoiceCh
      ? Object.values(activeStreams).filter(s => s.channelId === ch.id)
      : []
    const hasLiveStream = channelStreams.length > 0
    const isDragOver = dragOverChannelId === ch.id
    const isDragging = draggedChannelId === ch.id

    return (
      <div
        key={ch.id}
        draggable={isOwnerOrAdmin}
        onDragStart={isOwnerOrAdmin ? e => handleChannelDragStart(e, ch.id) : undefined}
        onDragOver={isOwnerOrAdmin ? e => handleChannelDragOver(e, ch.id) : undefined}
        onDrop={isOwnerOrAdmin ? e => handleChannelDrop(e, ch.id, groupChannels, categoryKey) : undefined}
        onDragEnd={isOwnerOrAdmin ? handleChannelDragEnd : undefined}
        className={`${isDragOver ? 'border-t-2 border-fc-accent' : ''} ${isDragging ? 'opacity-50' : ''} ${extraClass}`}
        onContextMenu={e => ctxMenu.open(e, [
          { label: 'Marquer comme lu', onClick: () => {} },
          { label: 'Copier le lien', onClick: () => navigator.clipboard.writeText(`${window.location.origin}/servers/${serverId}/channels/${ch.id}`) },
          { separator: true },
          { label: 'Paramètres du canal', onClick: () => setChannelSettings(ch) },
          ...(isOwnerOrAdmin ? [
            { label: ch.hidden ? 'Afficher le canal' : 'Masquer le canal', onClick: () => ch.hidden ? unhideChannelMutation.mutate(ch.id) : hideChannelMutation.mutate(ch.id) },
            { label: ch.archived ? 'Restaurer' : 'Archiver', onClick: () => archiveChannel.mutate(ch.id) },
            { separator: true as const },
            { label: 'Supprimer le canal', danger: true, onClick: () => { if (confirm(`Supprimer #${ch.name} ?`)) api.delete(`/servers/${serverId}/channels/${ch.id}`) } },
          ] : []),
        ])}
      >
        <button
          onClick={() => isVoiceCh ? handleVoiceChannelClick(ch) : nav(`/servers/${serverId}/channels/${ch.id}`)}
          className={`flex items-center gap-1.5 w-full px-2 py-1.5 rounded transition text-left group
            ${isMeConnected
              ? 'bg-green-600/20 text-green-300 hover:bg-green-600/30'
              : channelId === ch.id
              ? 'bg-fc-hover text-white'
              : unreadCounts[ch.id] > 0
                ? 'text-white font-semibold hover:bg-fc-hover/50'
                : 'text-fc-muted hover:bg-fc-hover/50 hover:text-fc-text'}`}
        >
          {/* Icône verrou pour canal vocal protégé */}
          {hasPassword && isVoiceCh && (
            <Lock size={10} className="text-yellow-400 flex-shrink-0 -mr-0.5" />
          )}
          {/* Icône auto-create */}
          {isAutoCreate && (
            <PlusCircle size={10} className="text-green-400 flex-shrink-0 -mr-0.5" />
          )}
          {/* Icône temporaire */}
          {isTemporary && !isAutoCreate && (
            <Timer size={10} className="text-purple-400 flex-shrink-0 -mr-0.5" />
          )}
          <span className={channelId === ch.id ? 'text-white' : unreadCounts[ch.id] > 0 ? 'text-white' : 'text-fc-muted'}>
            <ChannelIcon type={ch.type} size={16} />
          </span>
          <span className="text-sm truncate flex-1">{ch.name}</span>

          {/* Badge LIVE si stream actif dans ce canal */}
          {hasLiveStream && (
            <span className="flex items-center gap-0.5 bg-red-600 rounded-full px-1 py-0.5 flex-shrink-0 animate-pulse">
              <span className="w-1 h-1 bg-white rounded-full" />
              <span className="text-[9px] text-white font-bold">LIVE</span>
            </span>
          )}

          {/* Badge slowmode */}
          {slowmodeDelay > 0 && !isVoiceCh && (
            <span className="flex items-center gap-0.5 text-[10px] text-fc-muted flex-shrink-0" title={`Mode lent: ${slowmodeDelay}s`}>
              <Clock size={9} />
              {slowmodeDelay >= 3600 ? `${slowmodeDelay / 3600}h`
                : slowmodeDelay >= 60 ? `${slowmodeDelay / 60}m`
                : `${slowmodeDelay}s`}
            </span>
          )}

          {/* User limit sur canaux vocaux */}
          {isVoiceCh && userLimit > 0 && (
            <span className="text-[10px] text-fc-muted flex-shrink-0" title={`Limite: ${userLimit} utilisateurs`}>
              {participants.length}/{userLimit}
            </span>
          )}

          {isMeConnected && (
            <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" title="Vous êtes connecté ici" />
          )}
          {unreadCounts[ch.id] > 0 && channelId !== ch.id && !isVoiceCh && (
            <span className="flex-shrink-0 min-w-[18px] h-[18px] bg-fc-red text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
              {unreadCounts[ch.id] > 99 ? '99+' : unreadCounts[ch.id]}
            </span>
          )}

          {/* Poignée drag (visible au hover si owner/admin) */}
          {isOwnerOrAdmin && (
            <span
              className="opacity-0 group-hover:opacity-100 p-0.5 text-fc-muted cursor-grab active:cursor-grabbing flex-shrink-0"
              title="Réordonner"
            >
              <GripVertical size={12} />
            </span>
          )}
          {/* Bouton paramètres canal (visible au hover) */}
          <button
            onClick={e => { e.stopPropagation(); setChannelSettings(ch) }}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-fc-hover/70 text-fc-muted hover:text-white transition flex-shrink-0"
            title="Paramètres du canal"
          >
            <Settings size={12} />
          </button>
          {isOwnerOrAdmin && (
            <button
              onClick={e => { e.stopPropagation(); archiveChannel.mutate(ch.id) }}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-fc-hover/70 text-fc-muted hover:text-yellow-400 transition flex-shrink-0"
              title="Archiver ce canal"
            >
              <Archive size={12} />
            </button>
          )}
          <button
            onClick={e => { e.stopPropagation(); ch.hidden ? unhideChannelMutation.mutate(ch.id) : hideChannelMutation.mutate(ch.id) }}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-fc-hover/70 text-fc-muted hover:text-white transition flex-shrink-0"
            title={ch.hidden ? "Afficher ce canal" : "Masquer ce canal"}
          >
            <EyeOff size={12} />
          </button>
        </button>

        {/* Participants vocaux */}
        {isVoiceCh && participants.length > 0 && (
          <div className="ml-5 mb-0.5 space-y-0.5">
            {participants.map(p => (
              <div key={p.userId} className="flex items-center gap-1.5 px-2 py-0.5 rounded text-fc-muted/80">
                <div className="w-5 h-5 rounded-full bg-fc-accent overflow-hidden flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white">
                  {p.avatar
                    ? <img src={p.avatar} alt="" className="w-full h-full object-cover" />
                    : p.username.charAt(0).toUpperCase()}
                </div>
                <span className="text-[11px] truncate flex-1">{p.username}</span>
                {p.muted && <MicOff size={9} className="text-red-400 flex-shrink-0" />}
                {p.screen && <Monitor size={9} className="text-green-400 flex-shrink-0" />}
                {p.video && !p.screen && <Video size={9} className="text-blue-400 flex-shrink-0" />}
              </div>
            ))}
            {/* Streams Go Live actifs dans ce canal */}
            {channelStreams.map(s => (
              <button
                key={s.userId}
                onClick={() => nav(`/servers/${serverId}/channels/${ch.id}`)}
                className="flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-red-500/10 w-full text-left transition"
                title={`Regarder le live de ${s.username}`}
              >
                <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse flex-shrink-0" />
                <span className="text-[11px] text-red-400 truncate flex-1">{s.username} est en live</span>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto flex flex-col">
        {/* Header serveur */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="w-full shadow-sm border-b border-fc-bg/50 hover:brightness-110 transition overflow-hidden"
          >
            {server?.banner ? (
              <div className="relative h-16">
                <img src={server.banner} alt="" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/50" />
                <div className="absolute inset-0 flex items-end justify-between px-4 py-2">
                  <span className="font-semibold text-white text-sm truncate drop-shadow">{server.name}</span>
                  <ChevronDown size={16} className="text-white/80 flex-shrink-0" />
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between px-4 py-3">
                <span className="font-semibold text-white truncate">{server?.name ?? '...'}</span>
                <ChevronDown size={16} className="text-fc-muted flex-shrink-0" />
              </div>
            )}
          </button>

          <BoostButton serverId={serverId} />

          {(data?.boost_level ?? 0) > 0 && (
            <ServerBoostBanner
              boostLevel={data?.boost_level ?? 0}
              boostCount={data?.boost_count ?? 0}
              memberCount={data?.member_count ?? 0}
            />
          )}

          {menuOpen && (
            <div
              className="absolute top-full left-0 right-0 bg-fc-bg border border-fc-hover rounded-lg shadow-2xl z-40 m-1 p-1"
              onMouseLeave={() => setMenuOpen(false)}
            >
              <button
                onClick={() => { setShowInvite(true); setMenuOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-fc-accent text-fc-text hover:text-white text-sm transition"
              >
                <UserPlus size={16} /> Inviter des personnes
              </button>
              <div className="border-t border-fc-hover my-1" />
              <button
                onClick={() => { setShowCreateChannel(true); setMenuOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-fc-hover text-fc-muted hover:text-white text-sm transition"
              >
                <Plus size={16} /> Créer un canal
              </button>
              <div className="border-t border-fc-hover my-1" />
              <button
                onClick={() => { setShowSettings(true); setMenuOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-fc-hover text-fc-muted hover:text-white text-sm transition"
              >
                <Settings size={16} /> Paramètres du serveur
              </button>
              {isOwnerOrAdmin && (
                <>
                  <div className="border-t border-fc-hover my-1" />
                  <button
                    onClick={() => { nav(`/servers/${serverId}/admin`); setMenuOpen(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-fc-hover text-fc-muted hover:text-white text-sm transition"
                  >
                    <Shield size={16} /> Panel Admin
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="p-2 space-y-0.5 mt-2 flex-1">
          {categoryGroups.map(({ key, label, channels: groupChannels }) => {
            const isCollapsed = collapsed[key]

            return (
              <div key={key} className="mb-2">
                <div
                  className="flex items-center justify-between px-2 py-1 group cursor-pointer"
                  onClick={() => toggleGroup(key)}
                  onContextMenu={e => ctxMenu.open(e, [
                    { label: 'Créer un canal', onClick: () => setShowCreateChannel(true) },
                    ...(isOwnerOrAdmin && key !== UNCATEGORIZED_KEY ? [
                      { separator: true as const },
                      { label: 'Supprimer la catégorie', danger: true, onClick: () => { if (confirm(`Supprimer la catégorie "${label}" ?`)) api.delete(`/servers/${serverId}/categories/${key}`) } },
                    ] : []),
                  ])}
                  onDragOver={isOwnerOrAdmin && draggedChannelId ? e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } : undefined}
                  onDrop={isOwnerOrAdmin && draggedChannelId ? e => {
                    e.preventDefault()
                    const newCategoryId = key === UNCATEGORIZED_KEY ? null : key
                    moveChannel.mutate({ channelId: draggedChannelId, categoryId: newCategoryId })
                    setDraggedChannelId(null)
                    setDragOverChannelId(null)
                  } : undefined}
                >
                  <div className="flex items-center gap-1">
                    <ChevronRight
                      size={12}
                      className={`text-fc-muted transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                    />
                    <span className="text-xs font-semibold text-fc-muted uppercase tracking-wide select-none">{label}</span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowCreateChannel(true) }}
                    className="text-fc-muted opacity-0 group-hover:opacity-100 hover:text-white transition"
                    title={`Créer un canal dans ${label}`}
                  >
                    <Plus size={14} />
                  </button>
                </div>

                {!isCollapsed
                  ? groupChannels.map(ch => renderChannel(ch, groupChannels, '', key))
                  : groupChannels
                      .filter(c => (unreadCounts[c.id] ?? 0) > 0)
                      .map(ch => renderChannel(ch, groupChannels, '', key))
                }
              </div>
            )
          })}

          {channels.length === 0 && (
            <div className="text-center text-fc-muted text-xs py-4">
              Aucun canal — crée-en un !
            </div>
          )}

          {/* Canaux masqués */}
          {hiddenChannels.length > 0 && (
            <div className="mt-2 mb-1">
              <button
                onClick={() => setShowHidden(p => !p)}
                className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-fc-muted hover:text-white transition"
              >
                <EyeOff size={12} />
                {showHidden ? 'Masquer' : `Masqués (${hiddenChannels.length})`}
              </button>
              {showHidden && hiddenChannels.map((c: any) => renderChannel(c, hiddenChannels, 'opacity-50'))}
            </div>
          )}

          {/* Canaux archivés */}
          {isOwnerOrAdmin && archivedChannels.length > 0 && (
            <div className="mt-3 mb-2">
              <div
                className="flex items-center gap-1 px-2 py-1 cursor-pointer"
                onClick={() => toggleGroup('__archived__')}
              >
                <ChevronRight
                  size={10}
                  className={`text-fc-muted transition-transform ${!collapsed['__archived__'] ? 'rotate-90' : ''}`}
                />
                <span className="text-[10px] font-semibold text-fc-muted/60 uppercase tracking-wide">
                  Archivés ({archivedChannels.length})
                </span>
              </div>
              {!collapsed['__archived__'] && archivedChannels.map((ch: any) => (
                <div key={ch.id} className="flex items-center gap-1.5 px-2 py-1 rounded text-fc-muted/40 hover:bg-fc-hover/20 group transition">
                  <ChannelIcon type={ch.type} size={14} />
                  <span className="text-xs truncate flex-1 opacity-60">{ch.name}</span>
                  <button
                    onClick={() => archiveChannel.mutate(ch.id)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-fc-muted hover:text-white transition"
                    title="Restaurer le canal"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showCreateChannel && serverId && (
        <CreateChannelModal serverId={serverId} onClose={() => setShowCreateChannel(false)} />
      )}
      {showInvite && server && (
        <InviteModal serverId={server.id} serverName={server.name} onClose={() => setShowInvite(false)} />
      )}
      {showSettings && server && (
        <ServerSettingsModal server={server} onClose={() => setShowSettings(false)} />
      )}
      {channelSettings && serverId && (
        <ChannelSettingsModal
          channel={channelSettings}
          serverId={serverId}
          onClose={() => setChannelSettings(null)}
        />
      )}
      {passwordPrompt && serverId && (
        <VoicePasswordPrompt
          channelName={passwordPrompt.channel.name}
          onConfirm={(pw) => {
            setPasswordPrompt(null)
            nav(`/servers/${serverId}/channels/${passwordPrompt.channel.id}`, {
              state: { voicePassword: pw }
            })
          }}
          onClose={() => setPasswordPrompt(null)}
        />
      )}
      {ctxMenu.node}
    </>
  )
}
