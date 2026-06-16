import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronDown, Hash, Plus, Volume2, UserPlus, Settings,
  Video, Megaphone, MessagesSquare, Radio, ChevronRight
} from 'lucide-react'
import { useState } from 'react'
import api from '../../api/client'
import { usePresence } from '../../store/presence'
import CreateChannelModal from '../modals/CreateChannelModal'
import InviteModal from '../modals/InviteModal'
import ServerSettingsModal from '../modals/ServerSettingsModal'

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

const CHANNEL_GROUPS = [
  { label: 'Texte', types: ['text', 'announcement', 'forum'] },
  { label: 'Vocal & Vidéo', types: ['voice', 'video', 'stage'] },
]

export default function ChannelSidebar() {
  const { serverId, channelId } = useParams()
  const nav = useNavigate()
  const [showCreateChannel, setShowCreateChannel] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const getStatus = usePresence(s => s.getStatus)

  const { data } = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => api.get(`/servers/${serverId}`).then(r => r.data),
    enabled: !!serverId,
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

  const toggleGroup = (label: string) => {
    setCollapsed(prev => ({ ...prev, [label]: !prev[label] }))
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto flex flex-col">
        {/* Header serveur */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="w-full px-4 py-3 shadow-sm border-b border-fc-bg/50 flex items-center justify-between hover:bg-fc-hover transition"
          >
            <span className="font-semibold text-white truncate">{server?.name ?? '...'}</span>
            <ChevronDown size={16} className="text-fc-muted flex-shrink-0" />
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
          {CHANNEL_GROUPS.map(({ label, types }) => {
            const groupChannels = channels.filter((c: any) => types.includes(c.type))
            if (groupChannels.length === 0) return null
            const isCollapsed = collapsed[label]

            return (
              <div key={label} className="mb-2">
                <div
                  className="flex items-center justify-between px-2 py-1 group cursor-pointer"
                  onClick={() => toggleGroup(label)}
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
                    title={`Créer un canal ${label.toLowerCase()}`}
                  >
                    <Plus size={14} />
                  </button>
                </div>

                {!isCollapsed && groupChannels.map((ch: any) => (
                  <button
                    key={ch.id}
                    onClick={() => nav(`/servers/${serverId}/channels/${ch.id}`)}
                    className={`flex items-center gap-1.5 w-full px-2 py-1.5 rounded transition text-left group
                      ${channelId === ch.id
                        ? 'bg-fc-hover text-white'
                        : 'text-fc-muted hover:bg-fc-hover/50 hover:text-fc-text'}`}
                  >
                    <span className={channelId === ch.id ? 'text-white' : 'text-fc-muted'}>
                      <ChannelIcon type={ch.type} size={16} />
                    </span>
                    <span className="text-sm truncate flex-1">{ch.name}</span>
                    {ch.type === 'announcement' && (
                      <span className="text-xs text-yellow-400 opacity-60 group-hover:opacity-100">ann.</span>
                    )}
                    {ch.type === 'forum' && (
                      <span className="text-xs text-fc-muted opacity-0 group-hover:opacity-100">forum</span>
                    )}
                  </button>
                ))}
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
    </>
  )
}
