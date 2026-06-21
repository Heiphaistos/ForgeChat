import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronDown, Hash, Plus, Volume2, UserPlus, Settings,
  Video, Megaphone, MessagesSquare, Radio, ChevronRight,
  Mic, MicOff, Monitor, Clock, Lock, PlusCircle, Timer,
} from 'lucide-react'
import { useState } from 'react'
import api from '../../api/client'
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
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [channelSettings, setChannelSettings] = useState<any | null>(null)
  const [passwordPrompt, setPasswordPrompt] = useState<{ channel: any } | null>(null)
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

  const roomParticipants = useVoice(s => s.roomParticipants)
  const activeStreams = useVoice(s => s.activeStreams)
  const voiceChannelId = useVoice(s => s.channelId)
  const voiceJoin = useVoice(s => s.join)
  const { on: wsOn } = useWs()

  // Écouter les erreurs de join vocal
  useState(() => {
    const off = wsOn('VOICE_JOIN_ERROR', (d: any) => {
      if (d.reason === 'channel_full') {
        toast.error(`Canal plein (${d.current}/${d.limit} places)`)
      } else if (d.reason === 'wrong_password') {
        toast.error('Mot de passe incorrect')
      }
    })
    return off
  })

  const { data: dms = [] } = useQuery({
    queryKey: ['dms'],
    queryFn: () => api.get('/dms').then(r => r.data),
    enabled: !serverId,
  })

  if (!serverId) {
    return (
      <div className="flex-1 overflow-y-auto p-2">
        <div className="px-2 py-2 text-xs font-semibold text-fc-muted uppercase tracking-wide">
          Messages directs
        </div>
        {dms.map((dm: any) => {
          const liveStatus = getStatus(dm.other_user_id) || dm.status
          const isOnline = liveStatus === 'online'
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
                <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-fc-channel ${isOnline ? 'bg-fc-green' : 'bg-fc-muted'}`} />
              </div>
              <div className="min-w-0 text-left">
                <div className="text-sm font-medium text-fc-text truncate">{dm.username}</div>
                <div className={`text-xs ${isOnline ? 'text-fc-green' : 'text-fc-muted'}`}>
                  {isOnline ? 'En ligne' : 'Hors ligne'}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    )
  }

  const server = data?.server
  const channels: any[] = data?.channels ?? []

  const toggleGroup = (key: string) => {
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))
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

  const renderChannel = (ch: any) => {
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

    return (
      <div key={ch.id}>
        <button
          onClick={() => isVoiceCh ? handleVoiceChannelClick(ch) : nav(`/servers/${serverId}/channels/${ch.id}`)}
          className={`flex items-center gap-1.5 w-full px-2 py-1.5 rounded transition text-left group
            ${channelId === ch.id
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

          {/* Bouton paramètres canal (visible au hover) */}
          <button
            onClick={e => { e.stopPropagation(); setChannelSettings(ch) }}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-fc-hover/70 text-fc-muted hover:text-white transition flex-shrink-0"
            title="Paramètres du canal"
          >
            <Settings size={12} />
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

                {!isCollapsed && groupChannels.map(renderChannel)}
              </div>
            )
          })}

          {channels.length === 0 && (
            <div className="text-center text-fc-muted text-xs py-4">
              Aucun canal — crée-en un !
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
            // Navigation vers le canal vocal avec password dans le state
            nav(`/servers/${serverId}/channels/${passwordPrompt.channel.id}`, {
              state: { voicePassword: pw }
            })
          }}
          onClose={() => setPasswordPrompt(null)}
        />
      )}
    </>
  )
}
