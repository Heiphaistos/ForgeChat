import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Hash, Plus, Volume2, UserPlus, Settings } from 'lucide-react'
import { useState } from 'react'
import api from '../../api/client'
import CreateChannelModal from '../modals/CreateChannelModal'
import InviteModal from '../modals/InviteModal'
import ServerSettingsModal from '../modals/ServerSettingsModal'

export default function ChannelSidebar() {
  const { serverId, channelId } = useParams()
  const nav = useNavigate()
  const [showCreateChannel, setShowCreateChannel] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

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
        {dms.map((dm: any) => (
          <button
            key={dm.id}
            onClick={() => nav(`/dms/${dm.id}`)}
            className="flex items-center gap-2 w-full px-2 py-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"
          >
            <div className="relative flex-shrink-0">
              <div className="w-8 h-8 rounded-full bg-fc-accent flex items-center justify-center text-sm font-bold text-white">
                {dm.username.charAt(0).toUpperCase()}
              </div>
              <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-fc-channel ${dm.status === 'online' ? 'bg-fc-green' : 'bg-fc-muted'}`} />
            </div>
            <div className="min-w-0 text-left">
              <div className="text-sm font-medium text-fc-text truncate">{dm.username}</div>
              <div className="text-xs text-fc-muted">{dm.status === 'online' ? 'En ligne' : 'Hors ligne'}</div>
            </div>
          </button>
        ))}
      </div>
    )
  }

  const server = data?.server
  const channels: any[] = data?.channels ?? []
  const textChannels = channels.filter((c: any) => c.type === 'text')
  const voiceChannels = channels.filter((c: any) => c.type === 'voice')

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

          {/* Menu déroulant */}
          {menuOpen && (
            <div className="absolute top-full left-0 right-0 bg-fc-bg border border-fc-hover rounded-lg shadow-2xl z-40 m-1 p-1"
              onMouseLeave={() => setMenuOpen(false)}>
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
          {/* Canaux texte */}
          {textChannels.length > 0 && (
            <>
              <div className="flex items-center justify-between px-2 py-1 group">
                <span className="text-xs font-semibold text-fc-muted uppercase tracking-wide">Texte</span>
                <button
                  onClick={() => setShowCreateChannel(true)}
                  className="text-fc-muted opacity-0 group-hover:opacity-100 hover:text-white transition"
                  title="Créer un canal texte"
                >
                  <Plus size={14} />
                </button>
              </div>
              {textChannels.map((ch: any) => (
                <button
                  key={ch.id}
                  onClick={() => nav(`/servers/${serverId}/channels/${ch.id}`)}
                  className={`flex items-center gap-1.5 w-full px-2 py-1.5 rounded transition text-left group
                    ${channelId === ch.id
                      ? 'bg-fc-hover text-white'
                      : 'text-fc-muted hover:bg-fc-hover/50 hover:text-fc-text'}`}
                >
                  <Hash size={16} className="flex-shrink-0" />
                  <span className="text-sm truncate flex-1">{ch.name}</span>
                  {ch.topic && (
                    <span className="text-xs opacity-0 group-hover:opacity-100 text-fc-muted truncate max-w-[60px]" title={ch.topic}>
                      {ch.topic}
                    </span>
                  )}
                </button>
              ))}
            </>
          )}

          {/* Canaux vocaux */}
          {voiceChannels.length > 0 && (
            <>
              <div className="flex items-center justify-between px-2 py-1 mt-2 group">
                <span className="text-xs font-semibold text-fc-muted uppercase tracking-wide">Vocal</span>
                <button
                  onClick={() => setShowCreateChannel(true)}
                  className="text-fc-muted opacity-0 group-hover:opacity-100 hover:text-white transition"
                >
                  <Plus size={14} />
                </button>
              </div>
              {voiceChannels.map((ch: any) => (
                <button
                  key={ch.id}
                  className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded text-fc-muted hover:bg-fc-hover/50 hover:text-fc-text transition"
                >
                  <Volume2 size={16} className="flex-shrink-0" />
                  <span className="text-sm truncate">{ch.name}</span>
                </button>
              ))}
            </>
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
