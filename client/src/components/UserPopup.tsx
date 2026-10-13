import { useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Calendar, MessageCircle, ExternalLink, UserPlus, UserCheck, Check, X, Pencil, Ban } from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import api from '../api/client'
import { useNavigate } from 'react-router-dom'
import UserPrivateNotes from './UserPrivateNotes'
import UserSocialInfo from './UserSocialInfo'
import { AvatarDecoration, ProfileEffect, profileThemeBackground } from './ui/ProfileDecor'
import { dateLocale, useT, type Key } from '../i18n'
import AnimatedImg from './ui/AnimatedImg'
import ProfileBanner from './ui/ProfileBanner'
import UserName from './ui/UserName'
import ProfileLinks from './ui/ProfileLinks'
import ConnectedAccountsLinks from './ui/ConnectedAccountsLinks'
import { renderMarkdown } from '../utils/markdown'
import { useRemoteSupportItem } from './chat/RemoteSupport'
import AvatarRing, { pickRing } from './ui/AvatarRing'
import { CardPatternLayer, cardView } from './ui/ProfileCardParts'
import { ACTIVITY_ICONS, activityLabel } from '../lib/activity'
import { useMediaQuery } from '../hooks/useMediaQuery'

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
const STATUS_LABEL: Record<string, Key> = {
  online: 'presence.online', idle: 'presence.idle', dnd: 'presence.dnd',
  invisible: 'presence.invisible', offline: 'presence.offline',
}

interface Props {
  userId: string
  /** Serveur courant : ajoute surnom, date d'arrivée et rôles du membre. */
  serverId?: string
  anchorX: number
  anchorY: number
  onClose: () => void
}

export default function UserPopup({ userId, serverId, anchorX, anchorY, onClose }: Props) {
  const tr = useT()
  const ref = useRef<HTMLDivElement>(null)
  // Dernier onClose reçu : les écouteurs posés une seule fois ne gardent pas une fermeture périmée.
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })
  const nav = useNavigate()
  const qc = useQueryClient()

  const { data: user } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => api.get(`/users/${userId}`).then(r => r.data),
    enabled: !!userId,
    staleTime: 60_000,
  })

  const { data: profile } = useQuery({
    queryKey: ['profile', userId],
    queryFn: () => api.get(`/users/${userId}/profile`).then(r => r.data),
    enabled: !!userId,
    staleTime: 30_000,
  })

  const { data: member } = useQuery({
    queryKey: ['member', serverId, userId],
    queryFn: () => api.get(`/servers/${serverId}/members/${userId}`).then(r => r.data),
    enabled: !!serverId && !!userId,
    staleTime: 30_000,
  })

  // Profil propre à ce serveur (avatar, bannière, bio) prioritaire sur celui du compte.
  const banner = member?.server_banner ?? user?.banner
  const avatar = member?.server_avatar ?? user?.avatar
  const bio = member?.server_bio ?? user?.bio
  const theme = profileThemeBackground(user?.profile_color_primary, user?.profile_color_accent)
  // Carte de profil (mise en page, fond, motif, bannière) et anneau : serveur sinon compte.
  const { card, look, style: cardStyle } = cardView(user?.profile_card, user?.profile_color_primary, user?.profile_color_accent)
  const ring = pickRing(member?.server_avatar_ring, user?.avatar_ring)

  const remoteSupport = useRemoteSupportItem()(userId)
  const openDm = useMutation({
    mutationFn: () => api.post(`/dms/${userId}`).then(r => r.data),
    onSuccess: (dm: any) => { nav(`/dms/${dm.dm_id}`); onClose() },
    onError: (e: any) => toast.error(e.response?.data?.error ?? tr('profile.dmError')),
  })

  const refreshRelation = () => {
    void qc.invalidateQueries({ queryKey: ['profile', userId] })
    void qc.invalidateQueries({ queryKey: ['friends'] })
  }
  const sendFriend = useMutation({
    mutationFn: () => api.post('/friends', { user_id: userId }),
    onSuccess: () => { toast.success(tr('friends.requestSent')); refreshRelation() },
    onError: (e: any) => toast.error(e.response?.data?.error ?? tr('common.error')),
  })
  // Demande reçue : mêmes routes que la page Amis (POST /friends/:friendship_id/accept|decline).
  const answerFriend = useMutation({
    mutationFn: (accept: boolean) => api.post(`/friends/${profile?.friendship_id}/${accept ? 'accept' : 'decline'}`),
    onSuccess: (_r, accept) => { toast.success(tr(accept ? 'upop.accepted' : 'upop.declined')); refreshRelation() },
    onError: (e: any, accept) => toast.error(e.response?.data?.error ?? tr(accept ? 'friends.acceptError' : 'friends.declineError')),
  })

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCloseRef.current()
    }
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current() }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', keyHandler) }
  }, [])

  // Focus : sur la carte à l'ouverture, rendu à l'élément d'origine à la fermeture — sauf si
  // l'utilisateur a cliqué ailleurs sur un élément focalisable (on ne lui vole pas le focus).
  useEffect(() => {
    const node = ref.current
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null
    node?.focus({ preventScroll: true })
    return () => {
      const now = document.activeElement
      if (origin?.isConnected && (!now || now === document.body || node?.contains(now))) origin.focus({ preventScroll: true })
    }
  }, [])

  // Bottom-sheet sur mobile (cohérent avec les menus contextuels), suivi en direct (rotation),
  // popup positionnée à l'ancre sur desktop, clampée dans l'écran
  const isSheet = useMediaQuery('(max-width: 767px)')
  const relation: string | undefined = profile?.relationship
  const style: React.CSSProperties = isSheet
    ? { position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999, maxHeight: '80dvh' }
    : {
        position: 'fixed',
        left: Math.max(8, Math.min(anchorX, window.innerWidth - 356)),
        top: Math.max(8, Math.min(anchorY, window.innerHeight - 520)),
        maxHeight: 'calc(100dvh - 16px)',
        zIndex: 9999,
      }

  return (
    <>
    {isSheet && (
      <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} className="bg-black/50" aria-hidden onMouseDown={onClose} />
    )}
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      tabIndex={-1}
      aria-label={user ? tr('upop.profileOf', { name: user.username }) : tr('upop.profile')}
      style={isSheet ? { ...style, ...cardStyle, borderRadius: undefined } : { ...style, ...cardStyle }}
      className={isSheet
        ? 'bg-fc-bg border-t border-fc-hover rounded-t-2xl shadow-2xl overflow-y-auto overscroll-contain pb-[max(env(safe-area-inset-bottom),0.5rem)] sheet-slide-up outline-none'
        : 'w-[340px] bg-fc-bg border border-fc-hover rounded-xl shadow-2xl overflow-y-auto outline-none'}
    >
      <CardPatternLayer pattern={look.pattern} />
      {user && <ProfileEffect id={user.profile_effect} intensity={user.profile_effect_intensity} />}
      {/* Bannière entière (rognée seulement en mise en page compacte ou large) ; l'avatar déborde dessous. */}
      <div className="relative" aria-hidden>
        <ProfileBanner
          src={banner}
          minHeight={80}
          maxHeight={220}
          cover={look.banner.height ? { height: look.banner.height } : undefined}
          focus={look.banner.focus}
          className={look.banner.className}
          emptyClassName="h-28"
          emptyStyle={{ background: theme ?? (user ? getUserGradient(user.username) : 'linear-gradient(135deg, #5865f2 0%, #9b59b6 100%)') }}
        />
        {/* Avatar */}
        <div className={`absolute -bottom-12 ${look.centered ? 'left-1/2 -translate-x-1/2' : 'left-4'}`}>
          <AvatarDecoration id={user?.avatar_decoration} opts={user?.avatar_decoration_opts} size={84}>
          <AvatarRing ring={ring} size={96}>
          <div className="w-24 h-24 rounded-full border-[6px] border-fc-bg bg-fc-accent flex items-center justify-center font-bold text-3xl text-white overflow-hidden">
            {avatar
              ? <AnimatedImg src={avatar} alt={user?.username} loading="lazy" decoding="async" className="w-full h-full object-cover" />
              : (user?.username?.charAt(0)?.toUpperCase() ?? '?')}
          </div>
          </AvatarRing>
          </AvatarDecoration>
          {user && (
            <div
              className={`absolute bottom-1 right-1 w-6 h-6 rounded-full border-4 border-fc-bg ${STATUS_COLOR[user.status] ?? 'bg-fc-muted'}`}
              aria-label={tr(STATUS_LABEL[user.status] ?? 'presence.offline')}
              title={tr(STATUS_LABEL[user.status] ?? 'presence.offline')}
            />
          )}
        </div>
      </div>

      <div className="relative pt-14 px-4 pb-4">
        {user ? (
          <>
            <div className={`font-bold text-white text-xl break-words${look.nameCenter ? ' text-center' : ''}`}>
              <UserName userId={user.id} name={user.username} nickname={member?.nickname} withTag />
            </div>
            <div className={`text-xs text-fc-muted mb-1${look.nameCenter ? ' text-center' : ''}`}>
              {(member?.nickname || user.display_name) ? `${user.username}#${user.discriminator}` : `#${user.discriminator}`}
              {user.pronouns && <span> · {user.pronouns}</span>}
            </div>
            <div className={`text-xs text-fc-muted mb-3${look.nameCenter ? ' text-center' : ''}`}>
              {tr(STATUS_LABEL[user.status] ?? 'presence.offline')}
            </div>

            {(user.custom_status || user.custom_status_emoji) && (
              <div className="text-sm text-fc-text bg-fc-channel rounded-lg px-3 py-2 mb-3 italic">
                {user.custom_status_emoji && <span className="not-italic mr-1">{user.custom_status_emoji}</span>}
                {user.custom_status}
                {user.custom_status_expires_at && (
                  <div className="text-[11px] text-fc-muted not-italic mt-0.5">
                    {tr('profile.statusUntil', { time: format(new Date(user.custom_status_expires_at), 'd MMM HH:mm', { locale: dateLocale() }) })}
                  </div>
                )}
              </div>
            )}

            {user.activity_type && user.activity_name && (
              <div className="flex items-start gap-2 bg-fc-channel rounded-lg px-3 py-2 mb-3">
                <span className="text-base flex-shrink-0 mt-0.5">{ACTIVITY_ICONS[user.activity_type] ?? '🎯'}</span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide">
                    {tr(activityLabel(user.activity_type))}
                  </div>
                  <div className="text-sm text-white font-medium truncate">{user.activity_name}</div>
                  {user.activity_detail && (
                    <div className="text-xs text-fc-muted truncate">{user.activity_detail}</div>
                  )}
                </div>
              </div>
            )}

            <UserSocialInfo userId={userId} showBadges={card.show_badges} />

            {bio && (
              <div className="mb-3">
                <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">{tr('profile.about')}</div>
                <div className="text-sm text-fc-text break-words">{renderMarkdown(bio)}</div>
              </div>
            )}

            {card.show_links && <ProfileLinks links={user.profile_links} />}
            {card.show_links && <ConnectedAccountsLinks userId={userId} />}

            {profile && relation !== 'self' && (
              <UserPrivateNotes userId={userId} isFriend={profile.relationship === 'friend'} />
            )}

            <div className="flex items-center gap-1.5 text-xs text-fc-muted mb-4">
              <Calendar size={12} />
              {tr('settings.stats.memberSince')} {format(new Date(user.created_at), 'MMM yyyy', { locale: dateLocale() })}
            </div>

            {member && (
              <div className="mb-4 -mt-2 space-y-2">
                <div className="text-xs text-fc-muted">
                  {tr('popup.onServerSince', { date: format(new Date(member.joined_at), 'd MMM yyyy', { locale: dateLocale() }) })}
                </div>
                {(member.roles ?? []).length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">{tr('upop.roles')}</div>
                    <div className="flex flex-wrap gap-1">
                      {member.roles.map((r: any) => (
                        <span key={r.id} className="flex items-center gap-1 text-[11px] text-fc-text bg-fc-channel rounded px-1.5 py-0.5">
                          <span className="w-2 h-2 rounded-full" style={{ background: r.color ? `#${Number(r.color).toString(16).padStart(6, '0')}` : '#99aab5' }} />
                          {r.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="border-t border-fc-hover pt-3 flex flex-col gap-2">
              {/* Soi : modifier son profil ; bloqué : pas de message ; demande reçue : accepter / refuser. */}
              {relation === 'self' ? (
                <button
                  onClick={() => { nav('/settings?section=profile'); onClose() }}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition"
                >
                  <Pencil size={14} aria-hidden />
                  {tr('upop.editProfile')}
                </button>
              ) : relation === 'blocked' ? (
                <div className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-fc-hover text-fc-muted rounded-lg text-sm">
                  <Ban size={14} aria-hidden />
                  {tr('upop.blocked')}
                </div>
              ) : (
                <button
                  onClick={() => openDm.mutate()}
                  disabled={openDm.isPending}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition disabled:opacity-50"
                >
                  <MessageCircle size={14} aria-hidden />
                  {tr('msg.sendMessage')}
                </button>
              )}
              {remoteSupport && relation !== 'self' && (
                <button
                  onClick={() => { remoteSupport.onClick?.(); onClose() }}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-fc-hover hover:bg-fc-input text-fc-muted hover:text-white rounded-lg text-sm font-medium transition"
                >
                  {remoteSupport.icon}
                  {remoteSupport.label}
                </button>
              )}
              {relation === 'none' && (
                <button
                  onClick={() => sendFriend.mutate()}
                  disabled={sendFriend.isPending}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-green-600/20 hover:bg-green-600/30 text-green-400 rounded-lg text-sm font-medium transition disabled:opacity-50"
                >
                  <UserPlus size={14} aria-hidden />
                  {tr('um.addFriend')}
                </button>
              )}
              {relation === 'pending_received' && profile?.friendship_id && (
                <div role="group" aria-label={tr('upop.incoming', { name: user.username })} className="space-y-1.5">
                  <p className="text-xs text-fc-muted text-center">{tr('upop.incoming', { name: user.username })}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => answerFriend.mutate(true)}
                      disabled={answerFriend.isPending}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-green-600/20 hover:bg-green-600/30 text-green-400 rounded-lg text-sm font-medium transition disabled:opacity-50"
                    >
                      <Check size={14} aria-hidden />
                      {tr('friends.accept')}
                    </button>
                    <button
                      onClick={() => answerFriend.mutate(false)}
                      disabled={answerFriend.isPending}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-fc-hover hover:bg-red-600/20 text-fc-muted hover:text-red-400 rounded-lg text-sm font-medium transition disabled:opacity-50"
                    >
                      <X size={14} aria-hidden />
                      {tr('friends.decline')}
                    </button>
                  </div>
                </div>
              )}
              {(relation === 'pending_sent' || relation === 'friend') && (
                <div className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-fc-hover text-fc-muted rounded-lg text-sm">
                  <UserCheck size={14} aria-hidden />
                  {tr(relation === 'friend' ? 'upop.friends' : 'upop.requestSent')}
                </div>
              )}
              <button
                onClick={() => { nav(`/users/${userId}`); onClose() }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-fc-hover hover:bg-fc-input text-fc-muted hover:text-white rounded-lg text-sm font-medium transition"
              >
                <ExternalLink size={14} aria-hidden />
                {tr('dms.viewProfile')}
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
    </>
  )
}
