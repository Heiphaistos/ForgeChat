import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { MessageCircle, Users, ChevronDown, ChevronUp, ArrowLeft } from 'lucide-react'
import api from '../api/client'
import { useAuth } from '../store/auth'

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserPublic {
  id: string
  username: string
  discriminator: string
  avatar: string | null
  banner: string | null
  bio: string | null
  status: string
  custom_status: string | null
  activity_type: string | null
  activity_name: string | null
  activity_detail: string | null
  created_at: string
}

interface MutualServer {
  id: string
  name: string
  icon: string | null
  member_role_names: string[] | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(status: string): string {
  switch (status) {
    case 'online': return 'bg-fc-green'
    case 'idle': return 'bg-yellow-400'
    case 'dnd': return 'bg-fc-red'
    default: return 'bg-fc-muted'
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'online': return 'En ligne'
    case 'idle': return 'Absent'
    case 'dnd': return 'Ne pas déranger'
    default: return 'Hors ligne'
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// ─── Bio avec expand ──────────────────────────────────────────────────────────

const BIO_MAX = 190

function BioSection({ bio }: { bio: string }) {
  const [expanded, setExpanded] = useState(false)
  const truncated = bio.length > BIO_MAX && !expanded
  const displayed = truncated ? bio.slice(0, BIO_MAX) + '…' : bio

  return (
    <div>
      <p className="text-sm text-white/80 leading-relaxed whitespace-pre-wrap">{displayed}</p>
      {bio.length > BIO_MAX && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs text-fc-accent hover:underline flex items-center gap-0.5"
        >
          {expanded ? (
            <>Réduire <ChevronUp size={12} /></>
          ) : (
            <>Lire la suite <ChevronDown size={12} /></>
          )}
        </button>
      )}
    </div>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function ProfileSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-48 bg-fc-hover/50 rounded-t-xl" />
      <div className="px-6 pb-6 bg-fc-channel rounded-b-xl">
        <div className="flex items-end gap-4 -mt-12 mb-6">
          <div className="w-24 h-24 rounded-full bg-fc-hover border-4 border-fc-channel" />
          <div className="flex-1 pb-2">
            <div className="h-5 w-36 bg-fc-hover rounded mb-2" />
            <div className="h-3 w-24 bg-fc-hover/60 rounded" />
          </div>
        </div>
        <div className="space-y-2">
          <div className="h-4 w-full bg-fc-hover/40 rounded" />
          <div className="h-4 w-4/5 bg-fc-hover/40 rounded" />
        </div>
      </div>
    </div>
  )
}

// ─── Serveurs en commun ───────────────────────────────────────────────────────

function MutualServersSection({ userId }: { userId: string }) {
  const { data: mutual = [], isLoading } = useQuery<MutualServer[]>({
    queryKey: ['mutual-servers', userId],
    queryFn: () => api.get(`/users/${userId}/mutual-servers`).then((r) => r.data),
  })

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 bg-fc-hover/30 rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  if (mutual.length === 0) {
    return (
      <p className="text-fc-muted text-sm">Aucun serveur en commun.</p>
    )
  }

  return (
    <div className="space-y-2">
      {mutual.map((srv) => (
        <div key={srv.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-fc-hover/20 transition">
          <div className="w-8 h-8 rounded-lg bg-fc-bg flex items-center justify-center font-bold text-sm text-white overflow-hidden flex-shrink-0">
            {srv.icon ? (
              <img src={srv.icon} alt={srv.name} loading="lazy" decoding="async" className="w-full h-full object-cover" />
            ) : (
              srv.name.charAt(0).toUpperCase()
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white font-medium truncate">{srv.name}</p>
            {srv.member_role_names && srv.member_role_names.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-0.5">
                {srv.member_role_names.slice(0, 3).map((role) => (
                  <span
                    key={role}
                    className="px-1.5 py-0.5 rounded text-[10px] bg-fc-accent/15 text-fc-accent font-medium"
                  >
                    {role}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Page principale ──────────────────────────────────────────────────────────

export default function UserProfilePage() {
  const { userId } = useParams<{ userId: string }>()
  const nav = useNavigate()
  const { user: me } = useAuth()

  const { data: user, isLoading, isError } = useQuery<UserPublic>({
    queryKey: ['user', userId],
    queryFn: () => api.get(`/users/${userId}`).then((r) => r.data),
    enabled: !!userId,
  })

  const handleOpenDm = async () => {
    if (!userId) return
    try {
      const { data } = await api.post(`/dms/${userId}`)
      nav(`/dms/${data.dm_id}`)
    } catch {
      // silencieux — l'erreur sera visible dans le toast de la nav
    }
  }

  if (isLoading) {
    return (
      <div className="flex-1 bg-fc-chat overflow-y-auto p-6 max-w-2xl mx-auto w-full">
        <ProfileSkeleton />
      </div>
    )
  }

  if (isError || !user) {
    return (
      <div className="flex-1 bg-fc-chat flex items-center justify-center">
        <div className="text-center text-fc-muted">
          <Users size={48} className="mx-auto mb-4 opacity-30" />
          <p>Profil introuvable.</p>
          <button
            onClick={() => nav(-1)}
            className="mt-4 text-fc-accent hover:underline text-sm"
          >
            Retour
          </button>
        </div>
      </div>
    )
  }

  const isSelf = me?.id === user.id

  return (
    <div className="flex-1 bg-fc-chat overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Bouton retour */}
        <button
          onClick={() => nav(-1)}
          className="flex items-center gap-1.5 text-fc-muted hover:text-white text-sm mb-4 transition"
        >
          <ArrowLeft size={16} />
          Retour
        </button>

        {/* Carte profil */}
        <div className="bg-fc-channel rounded-xl overflow-hidden mb-4">
          {/* Banner */}
          <div className="relative h-48">
            {user.banner ? (
              <img
                src={user.banner}
                alt=""
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-indigo-700/60 via-purple-700/40 to-fc-accent/30" />
            )}
            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-fc-channel via-transparent to-transparent" />
          </div>

          {/* Avatar + infos */}
          <div className="px-6 pb-6">
            <div className="flex items-end gap-4 -mt-12 mb-4">
              {/* Avatar */}
              <div className="relative flex-shrink-0">
                <div className="w-24 h-24 rounded-full bg-fc-bg border-4 border-fc-channel overflow-hidden flex items-center justify-center font-bold text-3xl text-white">
                  {user.avatar ? (
                    <img src={user.avatar} alt={user.username} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                  ) : (
                    user.username.charAt(0).toUpperCase()
                  )}
                </div>
                {/* Indicateur statut */}
                <span
                  className={`absolute bottom-1 right-1 w-5 h-5 rounded-full border-2 border-fc-channel ${statusColor(user.status)}`}
                  title={statusLabel(user.status)}
                />
              </div>

              {/* Actions */}
              <div className="flex-1 pb-1 flex justify-end">
                {!isSelf && (
                  <button
                    onClick={handleOpenDm}
                    className="flex items-center gap-2 px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition"
                  >
                    <MessageCircle size={15} />
                    Message
                  </button>
                )}
              </div>
            </div>

            {/* Nom + statut */}
            <div className="mb-3">
              <h1 className="text-xl font-bold text-white leading-tight">
                {user.username}
                <span className="text-fc-muted font-normal text-base">#{user.discriminator}</span>
              </h1>
              {user.custom_status && (
                <p className="text-sm text-fc-muted mt-0.5">{user.custom_status}</p>
              )}
              {user.activity_type && user.activity_name && (
                <p className="text-xs text-fc-muted mt-0.5 capitalize">
                  {user.activity_type} {user.activity_name}
                  {user.activity_detail ? ` — ${user.activity_detail}` : ''}
                </p>
              )}
            </div>

            {/* Divider */}
            <div className="border-t border-fc-hover my-4" />

            {/* À propos */}
            {user.bio && (
              <section className="mb-4">
                <h2 className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">
                  À propos
                </h2>
                <BioSection bio={user.bio} />
              </section>
            )}

            {/* Membre depuis */}
            <section className="mb-4">
              <h2 className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">
                Membre depuis
              </h2>
              <p className="text-sm text-white/80">{formatDate(user.created_at)}</p>
            </section>
          </div>
        </div>

        {/* Serveurs en commun */}
        {!isSelf && userId && (
          <div className="bg-fc-channel rounded-xl p-5">
            <h2 className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <Users size={13} />
              Serveurs en commun
            </h2>
            <MutualServersSection userId={userId} />
          </div>
        )}
      </div>
    </div>
  )
}
