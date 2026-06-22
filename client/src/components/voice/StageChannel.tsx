import { useEffect, useState } from 'react'
import { Mic, Hand, UserPlus, Users } from 'lucide-react'
import { useWs } from '../../store/ws'
import toast from 'react-hot-toast'

// ─── Types ────────────────────────────────────────────────────────────────────
interface StageUser {
  user_id: string
  username: string
  avatar?: string
}

interface HandRaise extends StageUser {
  raised: boolean
}

interface Props {
  channelId: string
  serverId: string
  currentUserId: string
  isSpeaker: boolean
  isModerator: boolean
}

// ─── Avatar helpers ───────────────────────────────────────────────────────────
function Avatar({ user, size = 'md' }: { user: StageUser; size?: 'sm' | 'md' | 'lg' }) {
  const dims = { sm: 'w-7 h-7 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-14 h-14 text-base' }
  return (
    <div className={`${dims[size]} rounded-full bg-fc-accent flex items-center justify-center font-bold text-white overflow-hidden flex-shrink-0`}>
      {user.avatar
        ? <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
        : user.username.charAt(0).toUpperCase()}
    </div>
  )
}

// ─── Speaker tile ─────────────────────────────────────────────────────────────
function SpeakerTile({ user }: { user: StageUser }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative">
        <Avatar user={user} size="lg" />
        <div className="absolute -bottom-1 -right-1 bg-fc-green rounded-full p-0.5">
          <Mic size={8} className="text-white" />
        </div>
      </div>
      <span className="text-[11px] text-white font-medium text-center max-w-[60px] truncate">
        {user.username}
      </span>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function StageChannel({
  channelId,
  currentUserId,
  isSpeaker,
  isModerator,
}: Props) {
  const { send, on } = useWs()
  const [speakers, setSpeakers] = useState<StageUser[]>([])
  const [audience, setAudience] = useState<StageUser[]>([])
  const [handRaises, setHandRaises] = useState<HandRaise[]>([])
  const [handRaised, setHandRaised] = useState(false)
  const [hasRequestedSpeak, setHasRequestedSpeak] = useState(false)

  // WS listeners
  useEffect(() => {
    const unSpeakerAdd = on('STAGE_SPEAKER_ADD', (raw: unknown) => {
      const data = raw as StageUser & { channel_id?: string }
      if (data.channel_id && data.channel_id !== channelId) return
      setSpeakers(prev => {
        if (prev.some(s => s.user_id === data.user_id)) return prev
        return [...prev, { user_id: data.user_id, username: data.username, avatar: data.avatar }]
      })
      setAudience(prev => prev.filter(a => a.user_id !== data.user_id))
    })

    const unSpeakerRemove = on('STAGE_SPEAKER_REMOVE', (raw: unknown) => {
      const data = raw as { user_id: string; channel_id?: string }
      if (data.channel_id && data.channel_id !== channelId) return
      setSpeakers(prev => prev.filter(s => s.user_id !== data.user_id))
    })

    const unHandRaise = on('STAGE_HAND_RAISE', (raw: unknown) => {
      const data = raw as HandRaise & { channel_id?: string }
      if (data.channel_id && data.channel_id !== channelId) return
      setHandRaises(prev => {
        const without = prev.filter(h => h.user_id !== data.user_id)
        if (!data.raised) return without
        return [...without, { user_id: data.user_id, username: data.username, avatar: data.avatar, raised: true }]
      })
      if (data.raised && data.user_id !== currentUserId) {
        toast(`✋ ${data.username} demande à parler`, { duration: 3000 })
      }
    })

    return () => {
      unSpeakerAdd()
      unSpeakerRemove()
      unHandRaise()
    }
  }, [channelId, currentUserId, on])

  const handleRequestSpeak = () => {
    if (hasRequestedSpeak) return
    setHasRequestedSpeak(true)
    send({ type: 'STAGE_REQUEST_SPEAK', channel_id: channelId })
    toast('Demande envoyée aux modérateurs', { duration: 2500 })
  }

  const handleToggleHand = () => {
    const next = !handRaised
    setHandRaised(next)
    send({ type: 'STAGE_HAND_RAISE', channel_id: channelId, raised: next })
    if (!next) setHasRequestedSpeak(false)
  }

  const handleInviteToSpeak = (userId: string, username: string) => {
    send({ type: 'STAGE_INVITE_SPEAK', channel_id: channelId, target_user_id: userId })
    toast.success(`Invitation envoyée à ${username}`)
  }

  const currentUserInAudience = audience.some(a => a.user_id === currentUserId)

  return (
    <div className="flex flex-col h-full bg-fc-bg text-white">
      {/* Section Orateurs */}
      <div className="flex-shrink-0 p-4 border-b border-fc-hover">
        <div className="flex items-center gap-2 mb-3">
          <Mic size={14} className="text-fc-accent" />
          <span className="text-xs font-semibold text-fc-muted uppercase tracking-wider">
            Scene — Orateurs
          </span>
        </div>

        {speakers.length === 0 ? (
          <p className="text-xs text-fc-muted italic">Aucun orateur pour le moment</p>
        ) : (
          <div className="flex flex-wrap gap-4">
            {speakers.map(s => (
              <SpeakerTile key={s.user_id} user={s} />
            ))}
          </div>
        )}
      </div>

      {/* Section Audience */}
      <div className="flex-1 overflow-y-auto p-4 border-b border-fc-hover">
        <div className="flex items-center gap-2 mb-3">
          <Users size={14} className="text-fc-muted" />
          <span className="text-xs font-semibold text-fc-muted uppercase tracking-wider">
            Audience ({audience.length})
          </span>
        </div>

        {audience.length === 0 ? (
          <p className="text-xs text-fc-muted italic">Aucun spectateur</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {audience.map(a => (
              <div key={a.user_id} className="relative group flex flex-col items-center gap-1">
                <Avatar user={a} size="sm" />
                <span className="text-[9px] text-fc-muted truncate max-w-[48px]">{a.username}</span>
                {isModerator && a.user_id !== currentUserId && (
                  <button
                    onClick={() => handleInviteToSpeak(a.user_id, a.username)}
                    className="absolute -top-1 -right-1 bg-fc-accent rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition"
                    title="Inviter à parler"
                  >
                    <UserPlus size={8} className="text-white" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Mains levées */}
      {handRaises.length > 0 && (
        <div className="flex-shrink-0 p-4 border-b border-fc-hover bg-fc-yellow/5">
          <p className="text-xs font-semibold text-fc-yellow mb-2">
            ✋ Mains levées ({handRaises.length})
          </p>
          <div className="space-y-1.5">
            {handRaises.map(h => (
              <div key={h.user_id} className="flex items-center gap-2">
                <Avatar user={h} size="sm" />
                <span className="text-xs text-white flex-1">{h.username}</span>
                {isModerator && (
                  <button
                    onClick={() => handleInviteToSpeak(h.user_id, h.username)}
                    className="text-[10px] bg-fc-accent hover:bg-fc-accent/80 text-white px-2 py-0.5 rounded transition"
                  >
                    Inviter
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions (audience seulement, ou non-speaker) */}
      {!isSpeaker && (currentUserInAudience || audience.length === 0) && (
        <div className="flex-shrink-0 p-4 flex items-center gap-2">
          <button
            onClick={handleRequestSpeak}
            disabled={hasRequestedSpeak}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl bg-fc-accent hover:bg-fc-accent/80 text-white text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Mic size={14} />
            {hasRequestedSpeak ? 'Demande envoyée...' : 'Demander à parler'}
          </button>

          <button
            onClick={handleToggleHand}
            className={`p-2.5 rounded-xl transition ${
              handRaised
                ? 'bg-fc-yellow text-white'
                : 'bg-fc-hover text-fc-muted hover:text-white'
            }`}
            title={handRaised ? 'Baisser la main' : 'Lever la main'}
          >
            <Hand size={18} />
          </button>
        </div>
      )}
    </div>
  )
}
