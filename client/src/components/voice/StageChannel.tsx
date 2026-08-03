import { useEffect, useMemo, useRef, useState } from 'react'
import { Mic, Hand, UserPlus, UserMinus, LogOut, Users } from 'lucide-react'
import { useWs } from '../../store/ws'
import { useVoice } from '../../store/voice'
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
    <div aria-hidden className={`${dims[size]} rounded-full bg-fc-accent flex items-center justify-center font-bold text-white overflow-hidden flex-shrink-0`}>
      {user.avatar
        ? <img src={user.avatar} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
        : <span aria-hidden>{user.username.charAt(0).toUpperCase()}</span>}
    </div>
  )
}

// ─── Speaker tile ─────────────────────────────────────────────────────────────
function SpeakerTile({ user, canDemote, onDemote }: { user: StageUser; canDemote: boolean; onDemote: (userId: string, username: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-1.5 relative group">
      <div className="relative">
        <Avatar user={user} size="lg" />
        <div aria-hidden className="absolute -bottom-1 -right-1 bg-fc-green rounded-full p-0.5">
          <Mic size={8} className="text-white" />
        </div>
        {canDemote && (
          <button
            onClick={() => onDemote(user.user_id, user.username)}
            aria-label={`Rétrograder ${user.username}`}
            className="absolute -top-1 -right-1 bg-red-500 rounded-full p-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition"
          >
            <UserMinus size={8} className="text-white" aria-hidden />
          </button>
        )}
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
  serverId,
  currentUserId,
  isSpeaker,
  isModerator,
}: Props) {
  const { send, on } = useWs()
  const [speakers, setSpeakers] = useState<StageUser[]>([])
  const [handRaises, setHandRaises] = useState<HandRaise[]>([])
  const [handRaised, setHandRaised] = useState(false)
  const [hasRequestedSpeak, setHasRequestedSpeak] = useState(false)
  const [amSpeaking, setAmSpeaking] = useState(isSpeaker)

  // Audience dérivée de la présence vocale globale déjà suivie par le store
  // (VOICE_USER_JOINED/LEFT via initGlobalListeners) moins les speakers —
  // évite d'inventer un second mécanisme de présence rien que pour ce composant.
  const roomParticipants = useVoice(s => s.roomParticipants[channelId] ?? [])
  const audience = useMemo(
    () => roomParticipants
      .filter(p => !speakers.some(s => s.user_id === p.userId))
      .map(p => ({ user_id: p.userId, username: p.username, avatar: p.avatar })),
    [roomParticipants, speakers],
  )

  // Valeur figée au montage — la transition audience↔speaker en cours de session
  // est gérée explicitement par les listeners STAGE_SPEAKER_ADD/REMOVE ci-dessous,
  // pas par cet effet de montage (sinon double-join en boucle).
  const initialIsSpeakerRef = useRef(isSpeaker)

  // Le nettoyage du démontage a besoin de la valeur COURANTE de amSpeaking, pas
  // celle figée à l'exécution de l'effet de montage — d'où la ref tenue à jour.
  const amSpeakingRef = useRef(amSpeaking)
  amSpeakingRef.current = amSpeaking

  // ── Rejoindre le mesh vocal (réel si déjà speaker, écoute seule sinon) ─────
  useEffect(() => {
    send({ type: 'STAGE_JOIN', channel_id: channelId })
    useVoice.getState().join(channelId, serverId, false, undefined, undefined, !initialIsSpeakerRef.current)
    return () => {
      // Quitter réellement la scène (pas juste une reconnexion interne du mesh
      // vocal, cf. cleanup_stage côté serveur qui ne réagit plus qu'à ceci ou à
      // une vraie déconnexion) si on parlait au moment de quitter la page.
      if (amSpeakingRef.current) {
        send({ type: 'STAGE_LEAVE_SPEAKER', channel_id: channelId })
      }
      useVoice.getState().leave()
    }
  }, [channelId, serverId, send])

  // WS listeners
  useEffect(() => {
    const unState = on('STAGE_STATE', (raw: unknown) => {
      const data = raw as { channel_id: string; speakers: StageUser[]; hand_raises: HandRaise[] }
      if (data.channel_id !== channelId) return
      setSpeakers(data.speakers ?? [])
      setHandRaises(data.hand_raises ?? [])
    })

    const unSpeakerAdd = on('STAGE_SPEAKER_ADD', (raw: unknown) => {
      const data = raw as StageUser & { channel_id?: string }
      if (data.channel_id && data.channel_id !== channelId) return
      setSpeakers(prev => {
        if (prev.some(s => s.user_id === data.user_id)) return prev
        return [...prev, { user_id: data.user_id, username: data.username, avatar: data.avatar }]
      })
      if (data.user_id === currentUserId) {
        // Promu speaker : passer de l'écoute seule à un vrai micro
        setAmSpeaking(true)
        setHasRequestedSpeak(false)
        setHandRaised(false)
        useVoice.getState().leave()
        useVoice.getState().join(channelId, serverId, false, undefined, undefined, false)
      }
    })

    const unSpeakerRemove = on('STAGE_SPEAKER_REMOVE', (raw: unknown) => {
      const data = raw as { user_id: string; channel_id?: string }
      if (data.channel_id && data.channel_id !== channelId) return
      setSpeakers(prev => prev.filter(s => s.user_id !== data.user_id))
      if (data.user_id === currentUserId) {
        // Rétrogradé (ou a quitté la scène soi-même) : retour en écoute seule
        setAmSpeaking(false)
        useVoice.getState().leave()
        useVoice.getState().join(channelId, serverId, false, undefined, undefined, true)
      }
    })

    const unHandRaise = on('STAGE_HAND_RAISE', (raw: unknown) => {
      const data = raw as HandRaise & { channel_id?: string }
      if (data.channel_id && data.channel_id !== channelId) return
      setHandRaises(prev => {
        const without = prev.filter(h => h.user_id !== data.user_id)
        if (!data.raised) return without
        return [...without, { user_id: data.user_id, username: data.username, avatar: data.avatar, raised: true }]
      })
      if (data.raised && data.user_id === currentUserId) {
        setHandRaised(true)
      } else if (!data.raised && data.user_id === currentUserId) {
        setHandRaised(false)
        setHasRequestedSpeak(false)
      }
      if (data.raised && data.user_id !== currentUserId) {
        toast(`✋ ${data.username} demande à parler`, { duration: 3000 })
      }
    })

    return () => {
      unState()
      unSpeakerAdd()
      unSpeakerRemove()
      unHandRaise()
    }
  }, [channelId, serverId, currentUserId, on])

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

  const handleTakeFloor = () => {
    send({ type: 'STAGE_INVITE_SPEAK', channel_id: channelId, target_user_id: currentUserId })
    toast.success('Vous prenez la parole')
  }

  const handleLeaveSpeaker = () => {
    send({ type: 'STAGE_LEAVE_SPEAKER', channel_id: channelId })
  }

  const handleDemoteSpeaker = (userId: string, username: string) => {
    send({ type: 'STAGE_LEAVE_SPEAKER', channel_id: channelId, target_user_id: userId })
    toast(`${username} a été rétrogradé`, { duration: 2500 })
  }

  return (
    <div className="flex flex-col h-full bg-fc-bg text-white">
      {/* Section Orateurs */}
      <section aria-label="Orateurs sur scène" className="flex-shrink-0 p-4 border-b border-fc-hover">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2" aria-hidden>
            <Mic size={14} className="text-fc-accent" />
            <span className="text-xs font-semibold text-fc-muted uppercase tracking-wider">
              Scene — Orateurs
            </span>
          </div>
          {isModerator && !amSpeaking && (
            <button
              onClick={handleTakeFloor}
              className="text-[11px] font-medium text-fc-accent hover:text-fc-accent/80 transition"
            >
              Prendre la parole
            </button>
          )}
          {amSpeaking && (
            <button
              onClick={handleLeaveSpeaker}
              className="flex items-center gap-1 text-[11px] font-medium text-fc-muted hover:text-white transition"
            >
              <LogOut size={12} aria-hidden />
              Quitter la scène
            </button>
          )}
        </div>

        {speakers.length === 0 ? (
          <p role="status" className="text-xs text-fc-muted italic">Aucun orateur pour le moment</p>
        ) : (
          <div className="flex flex-wrap gap-4" role="list" aria-label={`${speakers.length} orateur${speakers.length > 1 ? 's' : ''}`}>
            {speakers.map(s => (
              <div key={s.user_id} role="listitem">
                <SpeakerTile
                  user={s}
                  canDemote={isModerator && s.user_id !== currentUserId}
                  onDemote={handleDemoteSpeaker}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Section Audience */}
      <section aria-label="Audience" className="flex-1 overflow-y-auto overscroll-contain p-4 border-b border-fc-hover">
        <div className="flex items-center gap-2 mb-3" aria-hidden>
          <Users size={14} className="text-fc-muted" />
          <span className="text-xs font-semibold text-fc-muted uppercase tracking-wider">
            Audience ({audience.length})
          </span>
        </div>

        {audience.length === 0 ? (
          <p role="status" className="text-xs text-fc-muted italic">Aucun spectateur</p>
        ) : (
          <div className="flex flex-wrap gap-2" role="list" aria-label={`${audience.length} spectateur${audience.length > 1 ? 's' : ''}`}>
            {audience.map(a => (
              <div key={a.user_id} role="listitem" className="relative group flex flex-col items-center gap-1">
                <Avatar user={a} size="sm" />
                <span className="text-[9px] text-fc-muted truncate max-w-[48px]" aria-hidden>{a.username}</span>
                {isModerator && a.user_id !== currentUserId && (
                  <button
                    onClick={() => handleInviteToSpeak(a.user_id, a.username)}
                    aria-label={`Inviter ${a.username} à parler`}
                    className="absolute -top-1 -right-1 bg-fc-accent rounded-full p-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition"
                  >
                    <UserPlus size={8} className="text-white" aria-hidden />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Mains levées */}
      {handRaises.length > 0 && (
        <section aria-label="Demandes à parler" aria-live="polite" className="flex-shrink-0 p-4 border-b border-fc-hover bg-fc-yellow/5">
          <p className="text-xs font-semibold text-fc-yellow mb-2">
            <span aria-hidden>✋ </span>Mains levées ({handRaises.length})
          </p>
          <div className="space-y-1.5">
            {handRaises.map(h => (
              <div key={h.user_id} className="flex items-center gap-2">
                <Avatar user={h} size="sm" />
                <span className="text-xs text-white flex-1">{h.username}</span>
                {isModerator && (
                  <button
                    onClick={() => handleInviteToSpeak(h.user_id, h.username)}
                    aria-label={`Inviter ${h.username} à parler`}
                    className="text-[10px] bg-fc-accent hover:bg-fc-accent/80 text-white px-2 py-0.5 rounded transition"
                  >
                    Inviter
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Actions (non-speaker uniquement — tout non-speaker fait partie de
          l'audience, `roomParticipants` n'inclut jamais l'utilisateur courant
          lui-même donc pas de garde supplémentaire possible ni nécessaire ici) */}
      {!amSpeaking && (
        <div className="flex-shrink-0 p-4 flex items-center gap-2">
          <button
            onClick={handleRequestSpeak}
            disabled={hasRequestedSpeak}
            aria-busy={hasRequestedSpeak}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl bg-fc-accent hover:bg-fc-accent/80 text-white text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Mic size={14} aria-hidden />
            {hasRequestedSpeak ? 'Demande envoyée...' : 'Demander à parler'}
          </button>

          <button
            onClick={handleToggleHand}
            aria-pressed={handRaised}
            aria-label={handRaised ? 'Baisser la main' : 'Lever la main'}
            className={`p-2.5 rounded-xl transition ${
              handRaised
                ? 'bg-fc-yellow text-white'
                : 'bg-fc-hover text-fc-muted hover:text-white'
            }`}
          >
            <Hand size={18} aria-hidden />
          </button>
        </div>
      )}
    </div>
  )
}
