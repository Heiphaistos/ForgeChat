import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Hash, Plus, Volume2, Settings,
  Video, Megaphone, MessagesSquare, Images, Radio, ChevronRight,
  Clock, Lock, PlusCircle, Timer,
  X, GripVertical, Archive, EyeOff, BellOff, Pencil,
} from 'lucide-react'
import { useState, useEffect, useCallback, useMemo } from 'react'
import OnboardingModal from '../modals/OnboardingModal'
import api from '../../api/client'
import { useContextMenu, longPress, type ContextMenuEntry } from '../ui/ContextMenu'
import { useUnread } from '../../store/unread'
import { useChannelNotif } from '../../store/channelNotif'
import { useVoice } from '../../store/voice'
import { useWs } from '../../store/ws'
import { useAuth } from '../../store/auth'
import { useDraft, useChat } from '../../store/chat'
import { SplitContext } from '../../contexts/SplitContext'
import { useContext } from 'react'
import CreateChannelModal from '../modals/CreateChannelModal'
import InviteModal from '../modals/InviteModal'
import ServerSettingsModal, { type ServerSettingsTab } from '../modals/ServerSettingsModal'
import ServerHeader from './ServerHeader'
import ChannelSettingsModal from '../modals/ChannelSettingsModal'
import VoicePasswordPrompt from '../modals/VoicePasswordPrompt'
import toast from 'react-hot-toast'
import { deleteWithBackup } from '../../lib/deleteWithBackup'
import { useServerPerms, PERM } from '../../hooks/useServerPerms'
import { useMobile } from '../../contexts/MobileContext'
import { useT } from '../../i18n'
import { openMessages, type RawMsg } from '../../e2e/conversations'
import ServerLookModal from '../modals/ServerLookModal'
import DmList, { TypingDots } from './DmList'
import VoicePeople, { VOICE_MEMBER_MIME } from './VoicePeople'
import { useMyUxPrefs } from '../../store/uxPrefs'

function ChannelIcon({ type, size = 16 }: { type: string; size?: number }) {
  switch (type) {
    case 'voice': return <Volume2 size={size} className="flex-shrink-0" />
    case 'video': return <Video size={size} className="flex-shrink-0" />
    case 'announcement': return <Megaphone size={size} className="flex-shrink-0" />
    case 'forum': return <MessagesSquare size={size} className="flex-shrink-0" />
    case 'media': return <Images size={size} className="flex-shrink-0" />
    case 'stage': return <Radio size={size} className="flex-shrink-0" />
    default: return <Hash size={size} className="flex-shrink-0" />
  }
}

const UNCATEGORIZED_KEY = '__uncategorized__'

export default function ChannelSidebar() {
  const { serverId, channelId } = useParams()
  const nav = useNavigate()
  const { closeSidebar } = useMobile()
  const t = useT()
  const [showCreateChannel, setShowCreateChannel] = useState(false)
  const [createInCategory, setCreateInCategory] = useState<string | null>(null)
  const [showInvite, setShowInvite] = useState(false)
  const [settingsTab, setSettingsTab] = useState<ServerSettingsTab | null>(null)
  const [showLook, setShowLook] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  // Ouvrir la modale paramètres serveur depuis le menu contextuel du rail
  useEffect(() => {
    // detail : onglet voulu (ex. « profile » depuis « Changer le pseudo » du menu utilisateur).
    const open = (e: Event) => setSettingsTab((e as CustomEvent<ServerSettingsTab | null>).detail ?? 'general')
    // « Inviter » et « Créer un salon » du menu de la vignette de serveur (ServerSidebar).
    const panel = (e: Event) => {
      const what = (e as CustomEvent<string>).detail
      if (what === 'invite') setShowInvite(true)
      else if (what === 'create-channel') setShowCreateChannel(true)
    }
    window.addEventListener('forgechat:open-server-settings', open)
    window.addEventListener('forgechat:open-server-panel', panel)
    return () => {
      window.removeEventListener('forgechat:open-server-settings', open)
      window.removeEventListener('forgechat:open-server-panel', panel)
    }
  }, [])
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
  const unreadCounts = useUnread(s => s.counts)
  const markRead = useUnread(s => s.markRead)
  const isChannelMuted = useChannelNotif(s => s.isMuted)
  const isServerMuted = useChannelNotif(s => s.isServerMuted)
  const setChannelMuted = useChannelNotif(s => s.setMuted)
  const effectiveMuted = (chId: string) => isChannelMuted(chId) || isServerMuted(serverId ?? '')
  const currentUser = useAuth(s => s.user)
  const drafts = useDraft(s => s.drafts)
  // Tick minute pour rafraîchir les horodatages relatifs (5m → 6m) sans event
  const [, setTimeTick] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => setTimeTick(t => t + 1), 60_000)
    return () => clearInterval(iv)
  }, [])
  const typingMap = useChat(s => s.typing)
  const isTypingIn = (id: string) => Object.keys(typingMap[id] ?? {}).length > 0

  // Mentions non lues par salon (GET /unread puis MENTION_CREATE / READ_STATE_UPDATE)
  const mentionCounts = useUnread(s => s.mentionCounts)
  const { setSplitChannelId } = useContext(SplitContext)

  const { data } = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => api.get(`/servers/${serverId}`).then(r => r.data),
    enabled: !!serverId,
    staleTime: 60_000,
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', serverId],
    queryFn: () => api.get(`/servers/${serverId}/categories`).then(r => r.data),
    enabled: !!serverId,
    staleTime: 60_000,
  })

  const ctxMenu = useContextMenu()

  const roomParticipants = useVoice(s => s.roomParticipants)
  // Modération vocale (P2-2) : menu contextuel sur un participant et
  // glisser-déposer vers un autre salon vocal (MOVE_MEMBERS).
  const canMoveMembers = useServerPerms(serverId).has(PERM.MOVE_MEMBERS)
  const [voiceDropTarget, setVoiceDropTarget] = useState<string | null>(null)
  const isVoiceMemberDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(VOICE_MEMBER_MIME)
  const dropVoiceMember = (e: React.DragEvent, channelId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setVoiceDropTarget(null)
    const userId = e.dataTransfer.getData(VOICE_MEMBER_MIME)
    if (!userId || !serverId || (roomParticipants[channelId] ?? []).some(p => p.userId === userId)) return
    api.patch(`/servers/${serverId}/members/${userId}/voice`, { channel_id: channelId })
      .catch((err: any) => toast.error(err?.response?.data?.error ?? t('channels.moveRefused')))
  }
  const activeStreams = useVoice(s => s.activeStreams)
  const voiceChannelId = useVoice(s => s.channelId)
  const voiceJoin = useVoice(s => s.join)
  const { on: wsOn } = useWs()

  // Écouter les erreurs de join vocal
  useEffect(() => {
    const offErr = wsOn('VOICE_JOIN_ERROR', (d: any) => {
      if (d.reason === 'channel_full') {
        toast.error(t('channels.voiceFull', { current: d.current, limit: d.limit }))
      } else if (d.reason === 'wrong_password') {
        toast.error(t('channels.wrongPassword'))
      }
    })
    const offRedirect = wsOn('VOICE_REDIRECT', () => {
      // Ne PAS rappeler voiceJoin ici : le store bascule déjà sur le canal
      // temporaire. L'ancien appel déclenchait un leave() qui vidait le canal,
      // le serveur le supprimait (is_temporary) et le join suivant échouait en
      // silence — les canaux « auto-create » étaient inutilisables.
      toast.success(t('channels.redirected'))
    })
    return () => { offErr(); offRedirect() }
  }, [voiceJoin, serverId])

  // Rafraîchir le serveur sur changements de rôles en temps réel
  useEffect(() => {
    if (!serverId) return
    const offCreate = wsOn('ROLE_CREATE', (d: any) => {
      if (d.server_id === serverId) qc.invalidateQueries({ queryKey: ['server', serverId] })
    })
    const offUpdate = wsOn('ROLE_UPDATE', (d: any) => {
      if (d.server_id === serverId) qc.invalidateQueries({ queryKey: ['server', serverId] })
    })
    const offDelete = wsOn('ROLE_DELETE', (d: any) => {
      if (d.server_id === serverId) qc.invalidateQueries({ queryKey: ['server', serverId] })
    })
    const offMember = wsOn('MEMBER_ROLE_UPDATE', (d: any) => {
      if (d.server_id === serverId) {
        qc.invalidateQueries({ queryKey: ['server', serverId] })
        qc.invalidateQueries({ queryKey: ['members', serverId] })
      }
    })
    return () => { offCreate(); offUpdate(); offDelete(); offMember() }
  }, [serverId])

  const reorderChannels = useMutation({
    mutationFn: (channel_ids: string[]) =>
      api.patch(`/servers/${serverId}/channels/reorder`, { channel_ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server', serverId] }),
    onError: () => toast.error(t('channels.reorderFailed')),
  })

  const archiveChannel = useMutation({
    mutationFn: (chId: string) => api.patch(`/servers/${serverId}/channels/${chId}/archive`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server', serverId] }),
    onError: () => toast.error(t('channels.archiveFailed')),
  })

  const hideChannelMutation = useMutation({
    mutationFn: (id: string) => api.post(`/channels/${id}/hide`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server', serverId] }),
    onError: () => toast.error(t('channels.hideFailed')),
  })

  const unhideChannelMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/channels/${id}/hide`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server', serverId] }),
    onError: () => toast.error(t('channels.unhideFailed')),
  })

  const moveChannel = useMutation({
    mutationFn: ({ channelId, categoryId }: { channelId: string; categoryId: string | null }) =>
      api.patch(`/channels/${channelId}/move`, { category_id: categoryId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server', serverId] }),
    onError: () => toast.error(t('channels.moveFailed')),
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

  const [chFilter, setChFilter] = useState('')
  // Reset du filtre canaux quand on change de serveur
  useEffect(() => { setChFilter('') }, [serverId])

  // ⚠️ Ces useMemo DOIVENT rester avant le `if (!serverId) return` :
  // les avoir après causait React #310/#300 (nombre de hooks variable) à
  // chaque navigation DM ↔ serveur — LE bug historique de crash navigation
  const server = data?.server
  const allChannels: any[] = data?.channels ?? []

  const { channels, hiddenChannels, archivedChannels, isOwnerOrAdmin } = useMemo(() => {
    const ch = allChannels.filter((c: any) => !c.archived && !c.hidden)
    const hidden = allChannels.filter((c: any) => c.hidden && !c.archived)
    const archived = allChannels.filter((c: any) => c.archived)
    const MANAGE_CHANNELS_BIT = 1 << 4
    const ADMINISTRATOR_BIT = 1 << 31
    const myRoleIds: string[] = data?.my_role_ids ?? []
    const myRoles = (data?.roles ?? []).filter((r: any) => myRoleIds.includes(r.id))
    const isAdmin = !!server && !!currentUser && (
      server.owner_id === currentUser.id ||
      myRoles.some((r: any) => {
        const p = Number(r.permissions ?? 0)
        return (p & ADMINISTRATOR_BIT) !== 0 || (p & MANAGE_CHANNELS_BIT) !== 0
      })
    )
    return { channels: ch, hiddenChannels: hidden, archivedChannels: archived, isOwnerOrAdmin: isAdmin }
  }, [allChannels, data, server, currentUser?.id])
  // Droits fins sur les salons (créer / modifier / supprimer), voir useServerPerms.
  const { canCreateChannels: canCreate, canEditChannels: canEdit, canDeleteChannel } = useServerPerms(serverId ?? undefined)
  const removeWithBackup = async (kind: 'channel' | 'category', id: string, name: string) => {
    if (!serverId) return
    if (await deleteWithBackup({ kind, serverId, serverName: server?.name, id, name })) {
      qc.invalidateQueries({ queryKey: ['server', serverId] })
      if (kind === 'category') qc.invalidateQueries({ queryKey: ['categories', serverId] })
    }
  }

  // « Masquer les salons rendus muets » (menu du serveur) : le salon ouvert reste visible.
  const hideMuted = useMyUxPrefs().hideMuted.includes(serverId ?? '')
  const mutedChannels = useChannelNotif(s => s.mutedChannels)
  const listed = hideMuted
    ? channels.filter((c: any) => c.id === channelId || !(mutedChannels.has(c.id) && isChannelMuted(c.id)))
    : channels
  // Construire les groupes dynamiques basés sur les catégories DB
  const categoryGroups = useMemo(() => {
    const groups: Array<{ key: string; label: string; channels: any[] }> = []
    for (const cat of categories) {
      const catChannels = listed.filter((c: any) => c.category_id === cat.id)
      // Catégorie vide (ex. modèle Jötunheim) : montrée à qui peut y créer un salon.
      if (catChannels.length > 0 || canCreate) {
        groups.push({ key: cat.id, label: cat.name, channels: catChannels })
      }
    }
    const knownCatIds = new Set(categories.map((c: any) => c.id))
    const uncategorized = listed.filter(
      (c: any) => !c.category_id || !knownCatIds.has(c.category_id)
    )
    if (categories.length === 0 && listed.length > 0) {
      const textChannels = listed.filter((c: any) => ['text', 'announcement', 'forum', 'media'].includes(c.type))
      const voiceChannels = listed.filter((c: any) => ['voice', 'video', 'stage'].includes(c.type))
      if (textChannels.length > 0) groups.push({ key: 'texte', label: t('channels.groupText'), channels: textChannels })
      if (voiceChannels.length > 0) groups.push({ key: 'vocal', label: t('channels.groupVoice'), channels: voiceChannels })
    } else if (uncategorized.length > 0) {
      groups.push({ key: UNCATEGORIZED_KEY, label: t('channels.uncategorized'), channels: uncategorized })
    }
    return groups
  }, [listed, categories, t, canCreate])

  if (!serverId) return <DmList />

  const toggleGroup = (key: string) => {
    setCollapsed(prev => {
      const next = { ...prev, [key]: !prev[key] }
      try { localStorage.setItem('fc_collapsed_cats', JSON.stringify(next)) } catch {}
      return next
    })
  }

  const handleVoiceChannelClick = (ch: any) => {
    if (ch.has_voice_password) {
      // Canal protégé — afficher le prompt password
      setPasswordPrompt({ channel: ch })
    } else {
      nav(`/servers/${serverId}/channels/${ch.id}`)
      closeSidebar()
    }
  }

  // Prefetch des messages au survol d'un canal texte — navigation instantanée au clic
  const prefetchChannelMessages = (chId: string) => {
    if (!serverId) return
    qc.prefetchQuery({
      queryKey: ['messages', serverId, chId, null],
      // Même forme que ChannelPage : messages chiffrés déjà déchiffrés dans le cache.
      queryFn: () => api.get(`/servers/${serverId}/channels/${chId}/messages`).then(r => openMessages('channel', chId, r.data as RawMsg[])),
      staleTime: 30_000,
    })
  }

  // Clic droit / appui long sur un salon.
  const channelMenu = (ch: any): ContextMenuEntry[] => {
    const channelMuted = isChannelMuted(ch.id)
    return [
      { label: t('channels.markRead'), onClick: () => markRead(ch.id, serverId) },
      { label: channelMuted ? t('channels.notifOn') : t('channels.notifOff'), onClick: () => {
        const next = !channelMuted
        setChannelMuted(ch.id, next)
        api.post(`/user/channel-notif/${ch.id}`, { level: next ? 'nothing' : 'inherit', muted: next })
      }},
      { label: t('channels.copyLink'), onClick: () => navigator.clipboard.writeText(`${window.location.origin}/servers/${serverId}/channels/${ch.id}`) },
      { separator: true },
      { label: t('channels.settings'), onClick: () => setChannelSettings(ch) },
      ...(canEdit ? [
        { label: ch.hidden ? t('channels.show') : t('channels.hide'), onClick: () => ch.hidden ? unhideChannelMutation.mutate(ch.id) : hideChannelMutation.mutate(ch.id) },
        { label: ch.archived ? t('channels.restore') : t('channels.archive'), onClick: () => archiveChannel.mutate(ch.id) },
      ] : []),
      ...(canDeleteChannel(ch.created_by) ? [
        { separator: true as const },
        { label: t('channels.delete'), danger: true, onClick: () => removeWithBackup('channel', ch.id, ch.name) },
      ] : []),
    ]
  }

  const renderChannel = (ch: any, groupChannels: any[], extraClass = '', categoryKey = '') => {
    const isVoiceCh = ch.type === 'voice' || ch.type === 'video' || ch.type === 'stage'
    const participants = isVoiceCh ? (roomParticipants[ch.id] ?? []) : []
    const isMeConnected = voiceChannelId === ch.id
    const hasPassword = !!ch.has_voice_password
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
        draggable={canEdit}
        onDragStart={canEdit ? e => handleChannelDragStart(e, ch.id) : undefined}
        onDragOver={e => {
          if (isVoiceMemberDrag(e)) {
            if (!isVoiceCh || ch.is_auto_create || ch.type === 'stage') return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setVoiceDropTarget(ch.id)
          } else if (canEdit) handleChannelDragOver(e, ch.id)
        }}
        onDragLeave={() => { if (voiceDropTarget === ch.id) setVoiceDropTarget(null) }}
        onDrop={e => {
          if (isVoiceMemberDrag(e)) dropVoiceMember(e, ch.id)
          else if (canEdit) handleChannelDrop(e, ch.id, groupChannels, categoryKey)
        }}
        onDragEnd={canEdit ? handleChannelDragEnd : undefined}
        className={`${isDragOver ? 'border-t-2 border-fc-accent' : ''} ${voiceDropTarget === ch.id ? 'ring-1 ring-fc-accent rounded' : ''} ${isDragging ? 'opacity-50' : ''} ${extraClass}`}
        onContextMenu={e => ctxMenu.open(e, channelMenu(ch))}
        {...longPress((x, y) => ctxMenu.openAt(x, y, channelMenu(ch)))}
      >
        <button
          onClick={() => { if (isVoiceCh) { handleVoiceChannelClick(ch) } else { nav(`/servers/${serverId}/channels/${ch.id}`); closeSidebar() } }}
          onAuxClick={e => {
            // Clic molette → ouvrir le canal texte dans le panneau split (desktop)
            if (e.button === 1 && !isVoiceCh && ch.type !== 'forum' && ch.type !== 'media') {
              e.preventDefault()
              setSplitChannelId(ch.id)
            }
          }}
          onMouseEnter={() => { if (!isVoiceCh && channelId !== ch.id) prefetchChannelMessages(ch.id) }}
          aria-current={channelId === ch.id ? 'page' : undefined}
          className={`flex items-center gap-1.5 w-full px-2 py-1.5 rounded transition text-left group
            ${isMeConnected
              ? 'bg-green-600/20 text-green-300 hover:bg-green-600/30'
              : channelId === ch.id
              ? 'bg-fc-hover text-white'
              : unreadCounts[ch.id] > 0 && !effectiveMuted(ch.id)
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
          <span className={channelId === ch.id ? 'text-white' : unreadCounts[ch.id] > 0 && !effectiveMuted(ch.id) ? 'text-white' : 'text-fc-muted'}>
            <ChannelIcon type={ch.type} size={16} />
          </span>
          <span className="text-sm truncate flex-1">{ch.name}</span>

          {/* Quelqu'un écrit dans ce canal */}
          {!isVoiceCh && channelId !== ch.id && isTypingIn(ch.id) && <TypingDots />}

          {/* Indicateur brouillon en attente dans ce canal */}
          {!isVoiceCh && !!drafts[ch.id] && channelId !== ch.id && (
            <Pencil size={11} className="text-fc-muted flex-shrink-0" aria-label={t('common.draftPending')} />
          )}

          {/* Badge LIVE si stream actif dans ce canal */}
          {hasLiveStream && (
            <span className="flex items-center gap-0.5 bg-red-600 rounded-full px-1 py-0.5 flex-shrink-0 animate-pulse">
              <span className="w-1 h-1 bg-white rounded-full" />
              <span className="text-[9px] text-white font-bold">LIVE</span>
            </span>
          )}

          {/* Badge slowmode */}
          {slowmodeDelay > 0 && !isVoiceCh && (
            <span className="flex items-center gap-0.5 text-[10px] text-fc-muted flex-shrink-0" title={t('channels.slowmode', { s: slowmodeDelay })}>
              <Clock size={9} />
              {slowmodeDelay >= 3600 ? `${slowmodeDelay / 3600}h`
                : slowmodeDelay >= 60 ? `${slowmodeDelay / 60}m`
                : `${slowmodeDelay}s`}
            </span>
          )}

          {/* User limit sur canaux vocaux */}
          {isVoiceCh && userLimit > 0 && (
            <span className="text-[10px] text-fc-muted flex-shrink-0" title={t('channels.userLimit', { n: userLimit })}>
              {participants.length}/{userLimit}
            </span>
          )}

          {isMeConnected && (
            <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" title={t('channels.connectedHere')} />
          )}
          {effectiveMuted(ch.id) && (
            <span title={t('channels.notifDisabled')} className="flex-shrink-0">
              <BellOff size={11} className="text-fc-muted/50" />
            </span>
          )}
          {/* Discord : pastille rouge chiffrée pour les mentions, point blanc pour le simple non-lu */}
          {channelId !== ch.id && !isVoiceCh && ((mentionCounts[ch.id] ?? 0) > 0 ? (
            <span role="status" aria-label={t(mentionCounts[ch.id] > 1 ? 'channels.mentions.other' : 'channels.mentions.one', { n: mentionCounts[ch.id] })} className="flex-shrink-0 min-w-[18px] h-[18px] bg-fc-red text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
              <span aria-hidden>{mentionCounts[ch.id] > 99 ? '99+' : mentionCounts[ch.id]}</span>
            </span>
          ) : unreadCounts[ch.id] > 0 && !effectiveMuted(ch.id) && (
            <span role="status" aria-label={t('common.unreadMessages')} className="flex-shrink-0 w-2 h-2 bg-white rounded-full" />
          ))}

          {/* Poignée drag (visible au hover si droit de modifier les salons) */}
          {canEdit && (
            <span
              className="opacity-0 group-hover:opacity-100 p-0.5 text-fc-muted cursor-grab active:cursor-grabbing flex-shrink-0"
              title={t('channels.reorder')}
            >
              <GripVertical size={12} />
            </span>
          )}
          {/* Bouton paramètres canal (visible au hover) */}
          <button
            onClick={e => { e.stopPropagation(); setChannelSettings(ch) }}
            className="opacity-100 md:opacity-0 md:group-hover:opacity-100 p-0.5 rounded hover:bg-fc-hover/70 text-fc-muted hover:text-white transition flex-shrink-0"
            title={t('channels.settings')}
            aria-label={t('channels.settingsOf', { name: ch.name })}
          >
            <Settings size={12} />
          </button>
          {canEdit && (
            <button
              onClick={e => { e.stopPropagation(); archiveChannel.mutate(ch.id) }}
              className="opacity-100 md:opacity-0 md:group-hover:opacity-100 p-0.5 rounded hover:bg-fc-hover/70 text-fc-muted hover:text-yellow-400 transition flex-shrink-0"
              title={t('channels.archiveThis')}
              aria-label={t('channels.archiveNamed', { name: ch.name })}
            >
              <Archive size={12} />
            </button>
          )}
          <button
            onClick={e => { e.stopPropagation(); ch.hidden ? unhideChannelMutation.mutate(ch.id) : hideChannelMutation.mutate(ch.id) }}
            className="opacity-100 md:opacity-0 md:group-hover:opacity-100 p-0.5 rounded hover:bg-fc-hover/70 text-fc-muted hover:text-white transition flex-shrink-0"
            title={ch.hidden ? t('channels.showThis') : t('channels.hideThis')}
            aria-label={ch.hidden ? t('channels.showNamed', { name: ch.name }) : t('channels.hideNamed', { name: ch.name })}
          >
            <EyeOff size={12} />
          </button>
        </button>

        {isVoiceCh && (participants.length > 0 || channelStreams.length > 0) && (
          <VoicePeople serverId={serverId} channel={ch} participants={participants} streams={channelStreams} canMove={canMoveMembers} />
        )}
      </div>
    )
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto overscroll-y-contain flex flex-col">
        <ServerHeader
          serverId={serverId}
          data={data}
          isAdmin={isOwnerOrAdmin}
          canCreate={canCreate}
          open={{
            invite: () => setShowInvite(true),
            createChannel: () => setShowCreateChannel(true),
            settings: tab => setSettingsTab(tab),
            look: () => setShowLook(true),
            onboarding: () => setShowOnboarding(true),
          }}
        />

        {/* Filtre rapide des canaux — sticky au-dessus des headers de catégorie */}
        <div className="px-2 pt-2 sticky top-0 z-20 bg-fc-channel">
          <div className="relative">
            <input
              value={chFilter}
              onChange={e => setChFilter(e.target.value)}
              placeholder={t('channels.filter')}
              aria-label={t('channels.filterLabel')}
              enterKeyHint="search"
              autoCapitalize="none"
              className="w-full pl-2.5 pr-8 py-1.5 bg-fc-input rounded text-sm text-white placeholder:text-fc-muted outline-none focus:ring-1 focus:ring-fc-accent"
            />
            {chFilter && (
              <button
                onClick={() => setChFilter('')}
                aria-label={t('common.clearFilter')}
                className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-fc-muted hover:text-white transition"
              >
                <X size={13} aria-hidden />
              </button>
            )}
          </div>
        </div>

        <div className="p-2 space-y-0.5 mt-2 flex-1">
          {categoryGroups.map(({ key, label, channels: groupChannels }) => {
            const filterQ = chFilter.trim().toLowerCase()
            const visibleChannels = filterQ
              ? groupChannels.filter((c: any) => (c.name ?? '').toLowerCase().includes(filterQ))
              : groupChannels
            if (filterQ && visibleChannels.length === 0) return null
            // Filtre actif → déplier de force pour montrer les résultats
            const isCollapsed = filterQ ? false : collapsed[key]

            return (
              <div key={key} className="mb-2">
                <div
                  role="button"
                  tabIndex={0}
                  className="fc-cat flex items-center justify-between px-2 py-1 group cursor-pointer sticky top-0 z-10 bg-fc-channel"
                  onClick={() => toggleGroup(key)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGroup(key) } }}
                  onContextMenu={e => ctxMenu.open(e, [
                    ...(canCreate ? [{ label: t('channels.create'), onClick: () => { setCreateInCategory(key); setShowCreateChannel(true) } }] : []),
                    ...(categories.some((c: any) => c.id === key && canDeleteChannel(c.created_by)) ? [
                      { separator: true as const },
                      { label: t('channels.deleteCategory'), danger: true, onClick: () => removeWithBackup('category', key, label) },
                    ] : []),
                  ])}
                  onDragOver={canEdit && draggedChannelId ? e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } : undefined}
                  onDrop={canEdit && draggedChannelId ? e => {
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
                    <span className="fc-cat-label text-xs font-semibold text-fc-muted uppercase tracking-wide select-none">{label}</span>
                  </div>
                  {canCreate && <button
                    onClick={(e) => { e.stopPropagation(); setCreateInCategory(key); setShowCreateChannel(true) }}
                    className="text-fc-muted opacity-100 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 hover:text-white transition"
                    title={t('channels.createIn', { name: label })}
                    aria-label={t('channels.createIn', { name: label })}
                  >
                    <Plus size={14} />
                  </button>}
                </div>

                {!isCollapsed
                  ? visibleChannels.map(ch => renderChannel(ch, groupChannels, '', key))
                  : visibleChannels
                      .filter(c => (unreadCounts[c.id] ?? 0) > 0)
                      .map(ch => renderChannel(ch, groupChannels, '', key))
                }
              </div>
            )
          })}

          {channels.length === 0 && (
            <div className="text-center text-fc-muted text-xs py-4">
              {t('channels.empty')}
            </div>
          )}

          {/* Aucun canal ne correspond au filtre */}
          {chFilter.trim() && channels.length > 0 &&
            !channels.some((c: any) => (c.name ?? '').toLowerCase().includes(chFilter.trim().toLowerCase())) && (
            <div className="text-center text-fc-muted text-xs py-4">{t('channels.noMatch')}</div>
          )}

          {/* Canaux masqués */}
          {hiddenChannels.length > 0 && (
            <div className="mt-2 mb-1">
              <button
                onClick={() => setShowHidden(p => !p)}
                className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-fc-muted hover:text-white transition"
              >
                <EyeOff size={12} />
                {showHidden ? t('channels.hideHidden') : t('channels.hiddenCount', { n: hiddenChannels.length })}
              </button>
              {showHidden && hiddenChannels.map((c: any) => renderChannel(c, hiddenChannels, 'opacity-50'))}
            </div>
          )}

          {/* Canaux archivés */}
          {canEdit && archivedChannels.length > 0 && (
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
                  {t('channels.archivedCount', { n: archivedChannels.length })}
                </span>
              </div>
              {!collapsed['__archived__'] && archivedChannels.map((ch: any) => (
                <div
                  key={ch.id}
                  className="flex items-center gap-1.5 px-2 py-1 rounded text-fc-muted/40 hover:bg-fc-hover/20 group transition"
                  onContextMenu={e => ctxMenu.open(e, [
                    { label: t('channels.restoreChannel'), onClick: () => archiveChannel.mutate(ch.id) },
                    ...(canDeleteChannel(ch.created_by) ? [
                      { separator: true as const },
                      { label: t('channels.deleteForever'), danger: true, onClick: () => removeWithBackup('channel', ch.id, ch.name) },
                    ] : []),
                  ])}
                >
                  <ChannelIcon type={ch.type} size={14} />
                  <span className="text-xs truncate flex-1 opacity-60">{ch.name}</span>
                  <button
                    onClick={() => archiveChannel.mutate(ch.id)}
                    className="opacity-100 md:opacity-0 md:group-hover:opacity-100 p-0.5 rounded text-fc-muted hover:text-white transition"
                    title={t('channels.restoreChannel')}
                    aria-label={t('channels.restoreNamed', { name: ch.name })}
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
        <CreateChannelModal serverId={serverId} defaultCategoryId={categories.some((c: any) => c.id === createInCategory) ? createInCategory : undefined}
          onClose={() => { setShowCreateChannel(false); setCreateInCategory(null) }} />
      )}
      {showInvite && server && (
        <InviteModal serverId={server.id} serverName={server.name} onClose={() => setShowInvite(false)} />
      )}
      {showOnboarding && server && (
        <OnboardingModal serverId={server.id} serverName={server.name} onClose={() => setShowOnboarding(false)} />
      )}
      {showLook && server && (
        <ServerLookModal serverId={server.id} serverName={server.name} onClose={() => setShowLook(false)} />
      )}
      {settingsTab && server && (
        <ServerSettingsModal server={server} initialTab={settingsTab} onClose={() => setSettingsTab(null)} isAdmin={isOwnerOrAdmin} />
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
