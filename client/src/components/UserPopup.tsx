import { useEffect, useRef } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Calendar, MessageCircle, ExternalLink } from 'lucide-react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import api from '../api/client'
import { useNavigate } from 'react-router-dom'

const ACTIVITY_ICONS: Record<string, string> = {
  playing: '🎮',
  listening: '🎵',
  watching: '📺',
  streaming: '📡',
  competing: '🏆',
}

const ACTIVITY_LABELS: Record<string, string> = {
  playing: 'Joue à',
  listening: 'Écoute',
  watching: 'Regarde',
  streaming: 'Stream',
  competing: 'En compétition sur',
}

// Gradient déterministe basé sur le hash du username (style Discord)
function getUserGradient(username: string): string {
  let hash = 0
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash)
  }
  const h1 = Math.abs(hash) % 360
  const h2 = (h1 + 40) % 360
  return `linear-gradient(135deg, hsl(${h1}, 65%, 45%) 0%, hsl(${h2}, 70%, 35%) 100%)`
}

const STATUS_COLOR: Record<string, string> = {
  online: 'bg-fc-green', idle: 'bg-fc-yellow',
  dnd: 'bg-fc-red', invisible: 'bg-fc-muted', offline: 'bg-fc-muted',
}
const STATUS_LABEL: Record<string, string> = {
  online: 'En ligne', idle: 'Absent', dnd: 'Ne pas déranger',
  invisible: 'Invisible', offline: 'Hors ligne',
}

interface Props {
  userId: string
  anchorX: number
  anchorY: number
  onClose: () => void
}

export default function UserPopup({ userId, anchorX, anchorY, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const nav = useNavigate()

  const { data: user } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => api.get(`/users/${userId}`).then(r => r.data),
    enabled: !!userId,
    staleTime: 60_000,
  })

  const openDm = useMutation({
    mutationFn: () => api.post(`/dms/${userId}`).then(r => r.data),
    onSuccess: (dm: any) => { nav(`/dms/${dm.dm_id}`); onClose() },
  })

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', keyHandler) }
  }, [])

  // Positionner la popup pour qu'elle reste dans l'écran
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(anchorX, window.innerWidth - 280),
    top: Math.min(anchorY, window.innerHeight - 300),
    zIndex: 9999,
  }

  return (
    <div ref={ref} style={style} className="w-64 bg-fc-bg border border-fc-hover rounded-xl shadow-2xl overflow-hidden">
      {/* Banner */}
      <div className="h-16 relative overflow-hidden">
        {user?.banner
          ? <img src={user.banner} alt="" className="w-full h-full object-cover" />
          : <div
              className="w-full h-full"
              style={{ background: user ? getUserGradient(user.username) : 'linear-gradient(135deg, #5865f2 0%, #9b59b6 100%)' }}
            />
        }
        {/* Avatar */}
        <div className="absolute -bottom-6 left-4">
          <div className="w-16 h-16 rounded-full border-4 border-fc-bg bg-fc-accent flex items-center justify-center font-bold text-xl text-white overflow-hidden">
            {user?.avatar
              ? <img src={user.avatar} alt="" className="w-full h-full object-cover" />
              : (user?.username?.charAt(0)?.toUpperCase() ?? '?')}
          </div>
          {user && (
            <div className={`absolute bottom-0.5 right-0.5 w-4 h-4 rounded-full border-2 border-fc-bg ${STATUS_COLOR[user.status] ?? 'bg-fc-muted'}`} />
          )}
        </div>
      </div>

      <div className="pt-8 px-4 pb-4">
        {user ? (
          <>
            <div className="font-bold text-white text-base">{user.username}</div>
            <div className="text-xs text-fc-muted mb-1">#{user.discriminator}</div>
            <div className="text-xs text-fc-muted mb-3">
              {STATUS_LABEL[user.status] ?? 'Hors ligne'}
            </div>

            {user.custom_status && (
              <div className="text-sm text-fc-text bg-fc-channel rounded-lg px-3 py-2 mb-3 italic">
                {user.custom_status}
              </div>
            )}

            {user.activity_type && user.activity_name && (
              <div className="flex items-start gap-2 bg-fc-channel rounded-lg px-3 py-2 mb-3">
                <span className="text-base flex-shrink-0 mt-0.5">{ACTIVITY_ICONS[user.activity_type] ?? '🎯'}</span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide">
                    {ACTIVITY_LABELS[user.activity_type] ?? user.activity_type}
                  </div>
                  <div className="text-sm text-white font-medium truncate">{user.activity_name}</div>
                  {user.activity_detail && (
                    <div className="text-xs text-fc-muted truncate">{user.activity_detail}</div>
                  )}
                </div>
              </div>
            )}

            {user.bio && (
              <div className="mb-3">
                <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">À propos</div>
                <div className="text-sm text-fc-text">{user.bio}</div>
              </div>
            )}

            <div className="flex items-center gap-1.5 text-xs text-fc-muted mb-4">
              <Calendar size={12} />
              Membre depuis {format(new Date(user.created_at), 'MMM yyyy', { locale: fr })}
            </div>

            <div className="border-t border-fc-hover pt-3 flex flex-col gap-2">
              <button
                onClick={() => openDm.mutate()}
                disabled={openDm.isPending}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition disabled:opacity-50"
              >
                <MessageCircle size={14} />
                Envoyer un message
              </button>
              <button
                onClick={() => { nav(`/users/${userId}`); onClose() }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-fc-hover hover:bg-fc-input text-fc-muted hover:text-white rounded-lg text-sm font-medium transition"
              >
                <ExternalLink size={14} />
                Voir le profil
              </button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-16">
            <div className="w-6 h-6 border-2 border-fc-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
    </div>
  )
}
