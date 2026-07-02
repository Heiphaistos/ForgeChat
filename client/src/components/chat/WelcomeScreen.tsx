import { useNavigate } from 'react-router-dom'
import { Hash, Volume2, Video, Megaphone, MessagesSquare, Radio, Users } from 'lucide-react'

interface Channel {
  id: string
  name: string
  type: string
}

interface Server {
  id: string
  name: string
  icon?: string | null
  banner?: string | null
  description?: string | null
  welcome_message?: string | null
  member_count: number
  channels?: Channel[]
}

interface Props {
  server: Server
  channels: Channel[]
}

function channelIcon(type: string) {
  switch (type) {
    case 'voice': return <Volume2 size={16} className="flex-shrink-0 text-fc-muted" />
    case 'video': return <Video size={16} className="flex-shrink-0 text-fc-muted" />
    case 'announcement': return <Megaphone size={16} className="flex-shrink-0 text-fc-muted" />
    case 'forum': return <MessagesSquare size={16} className="flex-shrink-0 text-fc-muted" />
    case 'stage': return <Radio size={16} className="flex-shrink-0 text-fc-muted" />
    default: return <Hash size={16} className="flex-shrink-0 text-fc-muted" />
  }
}

export default function WelcomeScreen({ server, channels }: Props) {
  const nav = useNavigate()

  const textChannels = channels.filter(c => c.type === 'text' || c.type === 'announcement')
  const firstText = textChannels[0]
  const publicChannels = channels.filter(c => c.type !== 'voice' && c.type !== 'video' && c.type !== 'stage').slice(0, 8)

  const initials = server.name
    .split(' ')
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div className="flex flex-col items-center h-full overflow-y-auto">
      {/* Banner */}
      {server.banner ? (
        <div className="w-full h-[250px] flex-shrink-0 overflow-hidden">
          <img
            src={server.banner}
            alt="Bannière du serveur"
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        <div className="w-full h-[180px] bg-gradient-to-br from-fc-accent/40 via-purple-700/30 to-fc-bg flex-shrink-0" />
      )}

      {/* Contenu centré */}
      <div className="w-full max-w-2xl px-8 py-8 flex flex-col items-center">
        {/* Icône serveur */}
        <div className="-mt-20 mb-4 w-[90px] h-[90px] rounded-full border-4 border-fc-bg bg-fc-accent flex items-center justify-center font-bold text-3xl text-white overflow-hidden shadow-xl flex-shrink-0">
          {server.icon
            ? <img src={server.icon} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
            : initials}
        </div>

        {/* Titre */}
        <h1 className="text-3xl font-extrabold text-white mb-2 text-center">
          Bienvenue sur <span className="text-fc-accent">{server.name}</span> !
        </h1>

        {/* Message de bienvenue ou description */}
        <p className="text-fc-muted text-center text-sm max-w-lg mb-2 leading-relaxed">
          {server.welcome_message
            ?? server.description
            ?? `Voici le serveur ${server.name}. Commence par choisir un canal et rejoindre la conversation !`}
        </p>

        {/* Compteur membres */}
        <div className="flex items-center gap-1.5 text-xs text-fc-muted mb-8">
          <Users size={13} />
          <span>{server.member_count} membre{server.member_count > 1 ? 's' : ''}</span>
        </div>

        {/* Liste des canaux */}
        {publicChannels.length > 0 && (
          <div className="w-full mb-8">
            <div className="text-xs font-semibold text-fc-muted uppercase tracking-widest mb-3">
              Canaux disponibles
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {publicChannels.map(ch => (
                <button
                  key={ch.id}
                  onClick={() => nav(`/servers/${server.id}/channels/${ch.id}`)}
                  className="flex items-center gap-2.5 px-4 py-3 bg-fc-channel hover:bg-fc-hover rounded-xl text-left transition group"
                >
                  {channelIcon(ch.type)}
                  <span className="text-sm text-fc-text group-hover:text-white transition truncate">
                    {ch.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* CTA principal */}
        {firstText && (
          <button
            onClick={() => nav(`/servers/${server.id}/channels/${firstText.id}`)}
            className="px-6 py-2.5 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg font-semibold text-sm transition shadow-lg"
          >
            Rejoindre #{firstText.name}
          </button>
        )}
      </div>
    </div>
  )
}
