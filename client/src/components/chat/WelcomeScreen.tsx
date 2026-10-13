import { mediaUrl } from '../../api/client'
import { useNavigate } from 'react-router-dom'
import { Hash, Volume2, Video, Megaphone, MessagesSquare, Images, Radio, Users } from 'lucide-react'
import ProfileBanner from '../ui/ProfileBanner'
import ServerIcon from '../ui/ServerIcon'
import StyledNameText from '../ui/StyledNameText'
import { useServerAppearance } from '../../hooks/useServerAppearance'
import { accentFill, bannerFocus } from '../../lib/serverAppearance'

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
    case 'voice': return <Volume2 size={16} className="flex-shrink-0 text-fc-muted" aria-hidden />
    case 'video': return <Video size={16} className="flex-shrink-0 text-fc-muted" aria-hidden />
    case 'announcement': return <Megaphone size={16} className="flex-shrink-0 text-fc-muted" aria-hidden />
    case 'forum': return <MessagesSquare size={16} className="flex-shrink-0 text-fc-muted" aria-hidden />
    case 'media': return <Images size={16} className="flex-shrink-0 text-fc-muted" aria-hidden />
    case 'stage': return <Radio size={16} className="flex-shrink-0 text-fc-muted" aria-hidden />
    default: return <Hash size={16} className="flex-shrink-0 text-fc-muted" aria-hidden />
  }
}

export default function WelcomeScreen({ server, channels }: Props) {
  const nav = useNavigate()
  const look = useServerAppearance(server.id)
  const style = look?.welcome ?? 'classic'
  const fill = accentFill(look)

  const textChannels = channels.filter(c => c.type === 'text' || c.type === 'announcement')
  const firstText = textChannels[0]
  const publicChannels = channels.filter(c => c.type !== 'voice' && c.type !== 'video' && c.type !== 'stage').slice(0, 8)
  const hasBanner = !!mediaUrl(server.banner)

  // Style d'accueil choisi dans l'apparence du serveur : classique (bannière en tête),
  // centré (sur la bannière floutée), carte (tout dans une carte), minimal (sans bannière).
  // La bannière est toujours montrée entière (ProfileBanner), jamais rognée.
  const banner = hasBanner && style !== 'minimal' && (
    <ProfileBanner
      src={server.banner}
      alt="Bannière du serveur"
      minHeight={120}
      maxHeight="45vh"
      focus={bannerFocus(look?.banner)}
      className={style === 'classic' ? 'flex-shrink-0' : 'rounded-2xl flex-shrink-0'}
    />
  )

  return (
    <div className={`relative flex flex-col items-center h-full overflow-y-auto overscroll-contain ${style === 'centered' ? 'justify-center' : ''}`}>
      {style === 'centered' && hasBanner && (
        <img src={mediaUrl(server.banner)} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover blur-3xl scale-110 opacity-30 pointer-events-none select-none" />
      )}
      {style === 'classic' && (banner || (
        <div
          className="w-full h-[180px] bg-gradient-to-br from-fc-accent/40 via-purple-700/30 to-fc-bg flex-shrink-0"
          style={fill ? { background: fill, opacity: 0.6 } : undefined}
        />
      ))}

      {/* Contenu */}
      <div className={`relative w-full max-w-2xl px-8 py-8 flex flex-col ${style === 'minimal' ? 'items-start' : 'items-center'} ${
        style === 'card' ? 'my-8 bg-fc-channel/90 rounded-2xl shadow-xl px-6' : ''}`}>
        {(style === 'centered' || style === 'card') && banner && <div className="w-full mb-6">{banner}</div>}

        {/* Icône serveur (forme et anneau de l'apparence) */}
        <div aria-label={server.name} className={`${style === 'classic' && !hasBanner ? '-mt-20' : ''} mb-4 flex-shrink-0`}>
          <ServerIcon name={server.name} icon={server.icon} look={look} size={style === 'minimal' ? 56 : 90} className="shadow-xl" />
        </div>

        {/* Titre */}
        <h1 className={`text-3xl font-extrabold text-white mb-2 ${style === 'minimal' ? 'text-left' : 'text-center'}`}>
          Bienvenue sur {look?.name
            ? <StyledNameText text={server.name} style={look.name} />
            : <span className="text-fc-accent">{server.name}</span>} !
        </h1>

        {/* Message de bienvenue ou description */}
        <p className={`text-fc-muted text-sm max-w-lg mb-2 leading-relaxed ${style === 'minimal' ? 'text-left' : 'text-center'}`}>
          {server.welcome_message
            ?? server.description
            ?? `Voici le serveur ${server.name}. Commence par choisir un canal et rejoindre la conversation !`}
        </p>

        {/* Compteur membres */}
        <div className="flex items-center gap-1.5 text-xs text-fc-muted mb-8">
          <Users size={13} aria-hidden />
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
                  aria-label={`Rejoindre #${ch.name}`}
                  className="flex items-center gap-2.5 px-4 py-3 bg-fc-channel hover:bg-fc-hover rounded-xl text-left transition group"
                >
                  {channelIcon(ch.type)}
                  <span className="text-sm text-fc-text group-hover:text-white transition truncate" aria-hidden>
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
            className="px-6 py-2.5 bg-fc-accent hover:brightness-110 text-white rounded-lg font-semibold text-sm transition shadow-lg"
            style={fill ? { background: fill } : undefined}
          >
            Rejoindre #{firstText.name}
          </button>
        )}
      </div>
    </div>
  )
}
