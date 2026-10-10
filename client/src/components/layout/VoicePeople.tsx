// Personnes d'un salon vocal dans la barre latérale : clic droit = menu utilisateur partagé
// (volume, modération…), glisser vers un autre salon (déplacer des membres), lives en cours.
import { useNavigate } from 'react-router-dom'
import { MicOff, Monitor, Video, VolumeX } from 'lucide-react'
import { mediaUrl } from '../../api/client'
import { useVoice, type ActiveStream, type VoiceRoomParticipant } from '../../store/voice'
import { useMobile } from '../../contexts/MobileContext'
import { useT } from '../../i18n'
import UserName from '../ui/UserName'
import { userMenuProps } from '../userMenu/store'

/** Type MIME du glisser-déposer d'un membre vers un autre salon vocal. */
export const VOICE_MEMBER_MIME = 'application/x-forgechat-voice-member'

export default function VoicePeople({ serverId, channel, participants, streams, canMove }: {
  serverId: string
  channel: { id: string; name: string }
  participants: VoiceRoomParticipant[]
  streams: ActiveStream[]
  canMove: boolean
}) {
  const t = useT()
  const nav = useNavigate()
  const { closeSidebar } = useMobile()
  const voiceJoin = useVoice(s => s.join)
  return (
    <div className="ml-5 mb-0.5 space-y-0.5">
      {participants.map(p => (
        <div
          key={p.userId}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded text-fc-muted/80 hover:bg-fc-hover/40"
          draggable={canMove}
          onDragStart={canMove ? e => {
            e.stopPropagation()
            e.dataTransfer.setData(VOICE_MEMBER_MIME, p.userId)
            e.dataTransfer.effectAllowed = 'move'
          } : undefined}
          {...userMenuProps({ userId: p.userId, username: p.username, avatar: p.avatar, serverId, voice: true })}
        >
          <div className="w-5 h-5 rounded-full bg-fc-accent overflow-hidden flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white">
            {p.avatar
              ? <img src={mediaUrl(p.avatar)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
              : p.username.charAt(0).toUpperCase()}
          </div>
          <UserName userId={p.userId} name={p.username} className="text-[11px] truncate flex-1" />
          {p.serverDeafened && <VolumeX size={9} className="text-red-500 flex-shrink-0" aria-label={t('voice.serverDeafened')} />}
          {p.muted && <MicOff size={9} className={`${p.serverMuted ? 'text-red-500' : 'text-red-400'} flex-shrink-0`} aria-label={p.serverMuted ? t('voice.serverMuted') : t('voice.micOff')} />}
          {p.screen && <Monitor size={9} className="text-green-400 flex-shrink-0" />}
          {p.video && !p.screen && <Video size={9} className="text-blue-400 flex-shrink-0" />}
        </div>
      ))}
      {/* Streams Go Live actifs dans ce canal */}
      {streams.map(s => (
        <button
          key={s.userId}
          onClick={() => {
            // Rejoint en écoute seule : regarder un live n'ouvre plus le micro
            // et ne demande plus l'autorisation du navigateur.
            voiceJoin(channel.id, serverId, false, undefined, channel.name, true)
            nav(`/servers/${serverId}/channels/${channel.id}`)
            closeSidebar()
          }}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-red-500/10 w-full text-left transition"
          title={t('channels.watchLive', { name: s.username })}
        >
          <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse flex-shrink-0" />
          <span className="text-[11px] text-red-400 truncate flex-1">{t('channels.isLive', { name: s.username })}</span>
        </button>
      ))}
    </div>
  )
}
