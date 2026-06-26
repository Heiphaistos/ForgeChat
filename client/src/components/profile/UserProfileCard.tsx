import { useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MessageCircle, Phone, UserPlus, UserCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import toast from 'react-hot-toast'
import api from '../../api/client'
import { usePresence } from '../../store/presence'
import AchievementBadges from './AchievementBadges'

// Gradient déterministe (même logique que UserPopup)
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
  online: 'bg-fc-green',
  idle: 'bg-fc-yellow',
  dnd: 'bg-fc-red',
  invisible: 'bg-fc-muted',
  offline: 'bg-fc-muted',
}

const STATUS_LABEL: Record<string, string> = {
  online: 'En ligne',
  idle: 'Absent',
  dnd: 'Ne pas déranger',
  invisible: 'Invisible',
  offline: 'Hors ligne',
}

interface UserProfileCardProps {
  userId: string
  position?: { x: number; y: number }
  onClose: () => void
  /** ID du serveur courant pour afficher la date d'entrée serveur */
  serverId?: string
}

export default function UserProfileCard({
  userId,
  position,
  onClose,
  serverId,
}: UserProfileCardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const nav = useNavigate()
  const qc = useQueryClient()
  const getStatus = usePresence(s => s.getStatus)

  // Fermer au clic extérieur et Escape
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const { data: user } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => api.get(`/users/${userId}`).then(r => r.data),
    enabled: !!userId,
    staleTime: 60_000,
  })

  const { data: profile } = useQuery({
    queryKey: ['user-profile', userId],
    queryFn: () => api.get(`/users/${userId}/profile`).then(r => r.data),
    enabled: !!userId,
    staleTime: 30_000,
  })

  // Membre du serveur courant (date d'entrée + rôles)
  const { data: memberInfo } = useQuery({
    queryKey: ['server-member', serverId, userId],
    queryFn: () => api.get(`/servers/${serverId}/members/${userId}`).then(r => r.data),
    enabled: !!serverId && !!userId,
    staleTime: 60_000,
  })

  const openDm = useMutation({
    mutationFn: () => api.post(`/dms/${userId}`).then(r => r.data),
    onSuccess: (dm: any) => { nav(`/dms/${dm.dm_id}`); onClose() },
    onError: () => toast.error('Impossible d\'ouvrir la conversation'),
  })

  const sendFriend = useMutation({
    mutationFn: () => api.post('/friends', { user_id: userId }),
    onSuccess: () => {
      toast.success('Demande d\'ami envoyée !')
      qc.invalidateQueries({ queryKey: ['user-profile', userId] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  // Positionner en restant dans l'écran
  const style: React.CSSProperties = { position: 'fixed', zIndex: 9999 }
  if (position) {
    const CARD_W = 320
    const CARD_H = 480
    style.left = Math.min(position.x, window.innerWidth - CARD_W - 8)
    style.top = Math.min(position.y, window.innerHeight - CARD_H - 8)
  }

  const liveStatus = getStatus(userId)
  const status = liveStatus !== 'offline' ? liveStatus : (user?.status ?? 'offline')
  const roles: Array<{ id: string; name: string; color?: string }> =
    memberInfo?.roles ?? profile?.roles ?? []

  return (
    <div ref={ref} style={style} className="w-80 bg-fc-bg border border-fc-hover rounded-xl shadow-2xl overflow-hidden">
      {/* Banner h-24 */}
      <div className="h-24 relative overflow-hidden flex-shrink-0">
        {user?.banner
          ? <img src={user.banner} alt="" className="w-full h-full object-cover" />
          : <div
              className="w-full h-full"
              style={{ background: user ? getUserGradient(user.username) : 'linear-gradient(135deg, #5865f2 0%, #9b59b6 100%)' }}
            />
        }
        {/* Avatar 80px chevauchant le banner */}
        <div className="absolute -bottom-10 left-4">
          <div className="w-20 h-20 rounded-full border-4 border-fc-bg bg-fc-accent flex items-center justify-center font-bold text-2xl text-white overflow-hidden">
            {user?.avatar
              ? <img src={user.avatar} alt="" className="w-full h-full object-cover" />
              : (user?.username?.charAt(0)?.toUpperCase() ?? '?')}
          </div>
          {user && (
            <div className={`absolute bottom-1 right-1 w-[18px] h-[18px] rounded-full border-2 border-fc-bg ${STATUS_COLOR[status] ?? 'bg-fc-muted'}`} />
          )}
        </div>
      </div>

      <div className="pt-12 px-4 pb-4 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 200px)' }}>
        {user ? (
          <>
            {/* Identité */}
            <div className="flex items-center gap-1.5 font-bold text-white text-lg leading-tight">
              {user.username}
              {user.verified && (
                <span
                  className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-fc-accent text-white text-xs font-bold flex-shrink-0"
                  title="Utilisateur vérifié"
                >✓</span>
              )}
            </div>
            <div className="text-xs text-fc-muted">#{user.discriminator} · {STATUS_LABEL[status] ?? 'Hors ligne'}</div>

            {/* Bio */}
            {user.bio && (
              <div className="bg-fc-channel rounded-lg px-3 py-2 mt-3">
                <p className="text-sm text-fc-text">{user.bio}</p>
              </div>
            )}

            {/* Dates */}
            <div className="bg-fc-channel rounded-lg px-3 py-2 mt-3 grid grid-cols-2 gap-2">
              <div>
                <div className="text-[10px] font-semibold text-fc-muted uppercase tracking-wide mb-0.5">
                  Membre depuis
                </div>
                <div className="text-xs text-white">
                  {user.created_at
                    ? format(new Date(user.created_at), 'MMM yyyy', { locale: fr })
                    : '—'}
                </div>
              </div>
              {memberInfo?.joined_at && (
                <div>
                  <div className="text-[10px] font-semibold text-fc-muted uppercase tracking-wide mb-0.5">
                    Sur ce serveur
                  </div>
                  <div className="text-xs text-white">
                    {format(new Date(memberInfo.joined_at), 'MMM yyyy', { locale: fr })}
                  </div>
                </div>
              )}
            </div>

            {/* Rôles */}
            {roles.length > 0 && (
              <div className="mt-3">
                <div className="text-[10px] font-semibold text-fc-muted uppercase tracking-wide mb-1.5">
                  Rôles
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {roles.map((role) => (
                    <span
                      key={role.id}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border border-fc-hover"
                      style={role.color ? {
                        borderColor: `${role.color}60`,
                        backgroundColor: `${role.color}20`,
                        color: role.color,
                      } : undefined}
                    >
                      {role.color && (
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: role.color }}
                        />
                      )}
                      {role.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <AchievementBadges userId={userId} />

            {/* Actions */}
            <div className="border-t border-fc-hover pt-3 mt-3 flex gap-2">
              <button
                onClick={() => openDm.mutate()}
                disabled={openDm.isPending}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition disabled:opacity-50"
              >
                <MessageCircle size={14} />
                Message
              </button>
              <button
                className="px-3 py-2 bg-fc-hover hover:bg-fc-input text-fc-muted hover:text-white rounded-lg transition"
                title="Appel vocal"
              >
                <Phone size={14} />
              </button>
              {(!profile?.relationship || profile.relationship === 'none') && (
                <button
                  onClick={() => sendFriend.mutate()}
                  disabled={sendFriend.isPending}
                  className="px-3 py-2 bg-green-600/20 hover:bg-green-600/30 text-green-400 rounded-lg transition disabled:opacity-50"
                  title="Ajouter en ami"
                >
                  <UserPlus size={14} />
                </button>
              )}
              {(profile?.relationship === 'pending_sent' || profile?.relationship === 'friend') && (
                <div
                  className="px-3 py-2 bg-fc-hover text-fc-muted rounded-lg"
                  title={profile.relationship === 'friend' ? 'Déjà amis' : 'Demande envoyée'}
                >
                  <UserCheck size={14} />
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-20">
            <div className="w-6 h-6 border-2 border-fc-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
    </div>
  )
}
