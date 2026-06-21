import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import {
  MessageCircle, UserPlus, UserCheck, UserX, Shield, Star, StarOff,
  Calendar, ArrowLeft, Clock, Ban, Check, Loader2,
} from 'lucide-react'
import api from '../api/client'
import { useAuth } from '../store/auth'
import toast from 'react-hot-toast'

const STATUS_COLOR: Record<string, string> = {
  online: 'bg-green-500', idle: 'bg-yellow-500',
  dnd: 'bg-red-500', invisible: 'bg-gray-500', offline: 'bg-gray-500',
}
const STATUS_LABEL: Record<string, string> = {
  online: 'En ligne', idle: 'Absent', dnd: 'Ne pas d��ranger',
  invisible: 'Invisible', offline: 'Hors ligne',
}
const ACTIVITY_ICONS: Record<string, string> = {
  playing: '🎮', listening: '🎵', watching: '📺', streaming: '📡', competing: '🏆',
}
const ACTIVITY_LABELS: Record<string, string> = {
  playing: 'Joue à', listening: 'Écoute', watching: 'Regarde',
  streaming: 'Stream', competing: 'En compétition sur',
}

function getUserGradient(username: string): string {
  let hash = 0
  for (let i = 0; i < username.length; i++)
    hash = username.charCodeAt(i) + ((hash << 5) - hash)
  const h1 = Math.abs(hash) % 360
  const h2 = (h1 + 40) % 360
  return `linear-gradient(135deg, hsl(${h1},65%,45%) 0%, hsl(${h2},70%,35%) 100%)`
}

export default function UserProfilePage() {
  const { userId } = useParams<{ userId: string }>()
  const nav = useNavigate()
  const { user: me } = useAuth()
  const qc = useQueryClient()

  const { data: profile, isLoading } = useQuery({
    queryKey: ['profile', userId],
    queryFn: () => api.get(`/users/${userId}/profile`).then(r => r.data),
    enabled: !!userId,
    staleTime: 30_000,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['profile', userId] })

  const openDm = useMutation({
    mutationFn: () => api.post(`/dms/${userId}`).then(r => r.data),
    onSuccess: (dm: any) => nav(`/dms/${dm.dm_id}`),
  })

  const sendFriend = useMutation({
    mutationFn: () => api.post('/friends', { user_id: userId }),
    onSuccess: () => { toast.success('Demande d\'ami envoyée'); invalidate() },
    onError: () => toast.error('Erreur lors de la demande'),
  })

  const removeFriend = useMutation({
    mutationFn: () => api.delete(`/friends/${userId}`),
    onSuccess: () => { toast.success('Ami retiré'); invalidate() },
  })

  const blockMutation = useMutation({
    mutationFn: () => profile?.relationship === 'blocked'
      ? api.delete(`/users/${userId}/block`)
      : api.post(`/users/${userId}/block`),
    onSuccess: () => {
      const msg = profile?.relationship === 'blocked' ? 'Utilisateur débloqué' : 'Utilisateur bloqué'
      toast.success(msg)
      invalidate()
    },
  })

  const favMutation = useMutation({
    mutationFn: () => profile?.is_favorite
      ? api.delete(`/users/${userId}/favorite`)
      : api.post(`/users/${userId}/favorite`),
    onSuccess: () => {
      toast.success(profile?.is_favorite ? 'Retiré des favoris' : 'Ajouté aux favoris')
      invalidate()
    },
  })

  const acceptFriend = useMutation({
    mutationFn: () => api.post(`/friends/${profile?.friendship_id}/accept`),
    onSuccess: () => { toast.success('Demande acceptée'); invalidate() },
  })

  if (isLoading) return (
    <div className="flex items-center justify-center h-screen bg-fc-bg">
      <Loader2 size={32} className="animate-spin text-fc-accent" />
    </div>
  )

  if (!profile) return (
    <div className="flex flex-col items-center justify-center h-screen bg-fc-bg gap-4">
      <Shield size={48} className="text-fc-muted" />
      <p className="text-fc-muted">Profil introuvable</p>
      <button onClick={() => nav(-1)} className="text-fc-accent hover:underline text-sm">← Retour</button>
    </div>
  )

  const isSelf = profile.relationship === 'self'
  const rel = profile.relationship as string

  return (
    <div className="min-h-screen bg-fc-bg overflow-y-auto">
      {/* Back button */}
      <button
        onClick={() => nav(-1)}
        className="fixed top-4 left-4 z-10 flex items-center gap-1.5 px-3 py-1.5 bg-fc-channel/80 backdrop-blur-sm rounded-lg text-fc-muted hover:text-white text-sm transition"
      >
        <ArrowLeft size={16} /> Retour
      </button>

      <div className="max-w-2xl mx-auto px-4 pt-8 pb-16">

        {/* Banner + Avatar */}
        <div className="relative rounded-2xl overflow-hidden mb-16">
          <div className="h-40">
            {profile.banner
              ? <img src={profile.banner} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full" style={{ background: getUserGradient(profile.username) }} />
            }
          </div>
          <div className="absolute -bottom-10 left-6">
            <div className="w-20 h-20 rounded-full border-4 border-fc-bg bg-fc-accent flex items-center justify-center font-bold text-2xl text-white overflow-hidden">
              {profile.avatar
                ? <img src={profile.avatar} alt="" className="w-full h-full object-cover" />
                : profile.username.charAt(0).toUpperCase()
              }
            </div>
            <div className={`absolute bottom-1 right-1 w-5 h-5 rounded-full border-2 border-fc-bg ${STATUS_COLOR[profile.status] ?? 'bg-gray-500'}`} />
          </div>
        </div>

        {/* Infos + actions */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">{profile.username}</h1>
            <span className="text-sm text-fc-muted">#{profile.discriminator}</span>
            <div className="flex items-center gap-1.5 mt-1">
              <div className={`w-2.5 h-2.5 rounded-full ${STATUS_COLOR[profile.status] ?? 'bg-gray-500'}`} />
              <span className="text-sm text-fc-muted">{STATUS_LABEL[profile.status] ?? 'Hors ligne'}</span>
            </div>

            {/* Badge relation */}
            {rel === 'friend' && (
              <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 bg-green-500/15 border border-green-500/30 text-green-400 text-xs rounded-full">
                <UserCheck size={11} /> Ami
              </span>
            )}
            {rel === 'pending_sent' && (
              <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 bg-yellow-500/15 border border-yellow-500/30 text-yellow-400 text-xs rounded-full">
                <Clock size={11} /> Demande envoyée
              </span>
            )}
            {rel === 'pending_received' && (
              <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 bg-blue-500/15 border border-blue-500/30 text-blue-400 text-xs rounded-full">
                <UserPlus size={11} /> Veut être ton ami
              </span>
            )}
            {rel === 'blocked' && (
              <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 bg-red-500/15 border border-red-500/30 text-red-400 text-xs rounded-full">
                <Ban size={11} /> Bloqué
              </span>
            )}
          </div>

          {/* Actions */}
          {!isSelf && me && (
            <div className="flex items-center gap-2 flex-wrap justify-end">

              {/* Message */}
              <button
                onClick={() => openDm.mutate()}
                disabled={openDm.isPending || rel === 'blocked'}
                className="flex items-center gap-1.5 px-3 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition disabled:opacity-40"
              >
                <MessageCircle size={15} />
                Message
              </button>

              {/* Ami / accepter / retirer */}
              {rel === 'none' && (
                <button
                  onClick={() => sendFriend.mutate()}
                  disabled={sendFriend.isPending}
                  className="flex items-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium transition disabled:opacity-40"
                >
                  <UserPlus size={15} />
                  Ajouter ami
                </button>
              )}
              {rel === 'pending_received' && (
                <button
                  onClick={() => acceptFriend.mutate()}
                  disabled={acceptFriend.isPending}
                  className="flex items-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium transition disabled:opacity-40"
                >
                  <Check size={15} />
                  Accepter
                </button>
              )}
              {(rel === 'friend' || rel === 'pending_sent') && (
                <button
                  onClick={() => removeFriend.mutate()}
                  disabled={removeFriend.isPending}
                  className="flex items-center gap-1.5 px-3 py-2 bg-fc-hover hover:bg-red-600/30 text-fc-muted hover:text-red-400 rounded-lg text-sm font-medium transition disabled:opacity-40"
                >
                  <UserX size={15} />
                  {rel === 'friend' ? 'Retirer ami' : 'Annuler demande'}
                </button>
              )}

              {/* Favoris */}
              <button
                onClick={() => favMutation.mutate()}
                disabled={favMutation.isPending}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition disabled:opacity-40 ${
                  profile.is_favorite
                    ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30'
                    : 'bg-fc-hover text-fc-muted hover:text-yellow-400'
                }`}
              >
                {profile.is_favorite ? <StarOff size={15} /> : <Star size={15} />}
                {profile.is_favorite ? 'Retirer favori' : 'Favoris'}
              </button>

              {/* Bloquer */}
              <button
                onClick={() => blockMutation.mutate()}
                disabled={blockMutation.isPending}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition disabled:opacity-40 ${
                  rel === 'blocked'
                    ? 'bg-red-600/20 text-red-400 hover:bg-red-600/30'
                    : 'bg-fc-hover text-fc-muted hover:text-red-400'
                }`}
              >
                <Ban size={15} />
                {rel === 'blocked' ? 'Débloquer' : 'Bloquer'}
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4">
          {/* Statut custom + activité */}
          {(profile.custom_status || profile.activity_type) && (
            <div className="bg-fc-channel rounded-xl p-4 space-y-3">
              {profile.custom_status && (
                <div className="text-sm text-fc-text italic">"{profile.custom_status}"</div>
              )}
              {profile.activity_type && profile.activity_name && (
                <div className="flex items-start gap-3">
                  <span className="text-xl">{ACTIVITY_ICONS[profile.activity_type] ?? '��'}</span>
                  <div>
                    <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide">
                      {ACTIVITY_LABELS[profile.activity_type] ?? profile.activity_type}
                    </div>
                    <div className="text-sm text-white font-medium">{profile.activity_name}</div>
                    {profile.activity_detail && (
                      <div className="text-xs text-fc-muted">{profile.activity_detail}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Bio */}
          {profile.bio && (
            <div className="bg-fc-channel rounded-xl p-4">
              <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">À propos</div>
              <p className="text-sm text-fc-text whitespace-pre-wrap">{profile.bio}</p>
            </div>
          )}

          {/* Serveurs en commun */}
          {profile.mutual_servers?.length > 0 && (
            <div className="bg-fc-channel rounded-xl p-4">
              <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3">
                Serveurs en commun · {profile.mutual_servers.length}
              </div>
              <div className="flex flex-wrap gap-2">
                {profile.mutual_servers.map((s: any) => (
                  <button
                    key={s.id}
                    onClick={() => nav(`/servers/${s.id}`)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-fc-hover hover:bg-fc-input rounded-lg text-sm text-white transition"
                  >
                    {s.icon
                      ? <img src={s.icon} alt="" className="w-5 h-5 rounded-full object-cover" />
                      : <div className="w-5 h-5 rounded-full bg-fc-accent flex items-center justify-center text-[10px] font-bold">{s.name.charAt(0)}</div>
                    }
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Membre depuis */}
          <div className="flex items-center gap-2 text-sm text-fc-muted">
            <Calendar size={14} />
            Membre depuis {format(new Date(profile.created_at), 'MMMM yyyy', { locale: fr })}
          </div>
        </div>
      </div>
    </div>
  )
}
