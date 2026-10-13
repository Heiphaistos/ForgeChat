import { useQuery } from '@tanstack/react-query'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useSwipeRightToClose } from '../../hooks/useSwipeClose'
import api from '../../api/client'
import { usePresence } from '../../store/presence'
import { userMenuProps } from '../userMenu/store'
import UserPopup from '../UserPopup'
import { RoleIcon, RoleMark, useRoleDecor, type RoleDecor } from '../../hooks/useRoleDecor'
import AnimatedImg from '../ui/AnimatedImg'
import UserName from '../ui/UserName'
import RichStatus from '../ui/RichStatus'
import { AvatarDecoration } from '../ui/ProfileDecor'
import AvatarRing from '../ui/AvatarRing'
import { useT, type Key } from '../../i18n'

interface Props {
  serverId: string
  onClose?: () => void
}

// Virtualisation maison : hauteurs fixes, seules les lignes proches de la zone
// visible sont montées (un serveur de plusieurs milliers de membres restait
// entièrement dans le DOM).
const ROW_H = 48
const HEADER_H = 32
const OVERSCAN_PX = 400

type ListItem =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'member'; key: string; m: any }

const STATUS_COLORS: Record<string, string> = {
  online: 'bg-fc-green',
  idle: 'bg-fc-yellow',
  dnd: 'bg-fc-red',
  offline: 'bg-fc-muted',
  invisible: 'bg-fc-muted',
}

const STATUS_LABELS: Record<string, Key> = {
  online: 'presence.online',
  idle: 'presence.idle',
  dnd: 'presence.dnd',
  offline: 'presence.offline',
  invisible: 'presence.invisible',
}

function MemberRow({ m, decor, serverId, onClick }: { m: any; decor?: RoleDecor; serverId: string; onClick: (e: React.MouseEvent) => void }) {
  const t = useT()
  const statusLabel = t(STATUS_LABELS[m.liveStatus] ?? 'presence.offline')
  return (
    <div
      role="listitem"
      aria-label={`${m.nickname ?? m.username} — ${statusLabel}${m.is_owner ? t('members.owner') : ''}`}
      style={{ height: ROW_H }}
      className="flex items-center gap-2 px-2 rounded hover:bg-fc-hover group cursor-pointer transition"
      onClick={onClick}
      {...userMenuProps({ userId: m.user_id, username: m.username, avatar: m.avatar, serverId })}
    >
      <div className="relative flex-shrink-0">
        <AvatarDecoration id={m.avatar_decoration} opts={m.avatar_decoration_opts} size={32}>
        <AvatarRing ring={m.server_avatar_ring} size={32}>
        <div className="w-8 h-8 rounded-full bg-fc-accent flex items-center justify-center font-semibold text-sm text-white overflow-hidden">
          {m.avatar
            ? <AnimatedImg src={m.avatar} alt={m.nickname ?? m.username} loading="lazy" decoding="async" className="w-full h-full rounded-full object-cover" />
            : (m.nickname ?? m.username).charAt(0).toUpperCase()}
        </div>
        </AvatarRing>
        </AvatarDecoration>
        <div
          className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-fc-channel ${STATUS_COLORS[m.liveStatus] ?? 'bg-fc-muted'}`}
          aria-label={statusLabel}
          title={statusLabel}
        />
      </div>
      <div className="min-w-0">
        <div className={`text-sm font-medium truncate ${m.liveStatus === 'offline' || m.liveStatus === 'invisible' ? 'text-fc-muted' : 'text-fc-text group-hover:text-white'}`}>
          <UserName userId={m.user_id} name={m.username} nickname={m.nickname} roleStyle={decor?.style} roleOverrides={decor?.overridesName} serverStyle={m.server_name_style} clanTags={m.tags} />
          {decor?.icon && <span className="ml-1"><RoleIcon icon={decor.icon} title={decor.iconTitle} /></span>}
          {decor?.mark && <span className="ml-1 inline-flex"><RoleMark mark={decor.mark} /></span>}
          {m.is_owner && <span aria-hidden className="ml-1 text-xs text-fc-yellow">👑</span>}
        </div>
        {(m.activity_type && m.activity_name) || m.in_call ? (
          <RichStatus activity={m} className="text-xs text-fc-muted" />
        ) : m.custom_status ? (
          <div className="text-xs text-fc-muted truncate">{m.custom_status}</div>
        ) : null}
      </div>
    </div>
  )
}

export default function MemberList({ serverId, onClose }: Props) {
  const t = useT()
  const { data: members = [] } = useQuery({
    queryKey: ['members', serverId],
    queryFn: () => api.get(`/servers/${serverId}/members`).then(r => r.data),
    // Plus de rechargement périodique : la présence arrive par WS (usePresence) et
    // App.tsx invalide ['members', serverId] sur MEMBER_JOIN/LEAVE/REMOVE/KICKED/
    // BANNED/UNBAN/ROLE_UPDATE/NICKNAME_UPDATE/TIMEOUT et USER_UPDATE.
    staleTime: 5 * 60_000,
  })

  const roleDecor = useRoleDecor(serverId)
  const presenceStatuses = usePresence(s => s.statuses)
  // Activité en direct (WS) : remplace l'ancien rechargement toutes les 30 s
  const presenceActivities = usePresence(s => s.activities)
  const getStatus = (id: string) => presenceStatuses[id] ?? 'offline'
  const [popup, setPopup] = useState<{ userId: string; x: number; y: number } | null>(null)

  const { online, offline } = useMemo(() => {
    const withStatus = (members as any[]).map((m: any) => {
      const act = presenceActivities[m.user_id]
      return {
        ...m,
        ...(act ? { activity_type: act.activity_type, activity_name: act.activity_name, in_call: act.in_call } : {}),
        liveStatus: getStatus(m.user_id) ?? m.status ?? 'offline',
      }
    })
    return {
      online: withStatus.filter((m: any) =>
        m.liveStatus === 'online' || m.liveStatus === 'idle' || m.liveStatus === 'dnd'
      ),
      offline: withStatus.filter((m: any) =>
        m.liveStatus === 'offline' || m.liveStatus === 'invisible'
      ),
    }
  }, [members, presenceStatuses, presenceActivities])


  const [search, setSearch] = useState('')
  const swipe = useSwipeRightToClose(() => onClose?.())
  const query = search.trim().toLowerCase()
  const filteredOnline = useMemo(
    () => query ? online.filter((m: any) => (m.nickname ?? m.username).toLowerCase().includes(query)) : online,
    [online, query])
  const filteredOffline = useMemo(
    () => query ? offline.filter((m: any) => (m.nickname ?? m.username).toLowerCase().includes(query)) : offline,
    [offline, query])

  // Liste aplatie (titres de groupe + membres) avec la position verticale de chaque élément
  const { items, offsets, totalHeight } = useMemo(() => {
    const items: ListItem[] = []
    if (filteredOnline.length > 0) {
      items.push({ kind: 'header', key: 'h-online', label: t('members.onlineCount', { n: filteredOnline.length }) })
      for (const m of filteredOnline) items.push({ kind: 'member', key: m.user_id, m })
    }
    if (filteredOffline.length > 0) {
      items.push({ kind: 'header', key: 'h-offline', label: t('members.offlineCount', { n: filteredOffline.length }) })
      for (const m of filteredOffline) items.push({ kind: 'member', key: m.user_id, m })
    }
    const offsets: number[] = []
    let y = 0
    for (const it of items) { offsets.push(y); y += it.kind === 'header' ? HEADER_H : ROW_H }
    return { items, offsets, totalHeight: y }
  }, [filteredOnline, filteredOffline, t])

  const scrollRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ top: 0, height: 1200 })
  const measure = useCallback(() => {
    const el = scrollRef.current
    const list = listRef.current
    if (!el || !list) return
    setView({ top: el.scrollTop - list.offsetTop, height: el.clientHeight })
  }, [])
  useLayoutEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  const minY = view.top - OVERSCAN_PX
  const maxY = view.top + view.height + OVERSCAN_PX
  const visible: number[] = []
  for (let i = 0; i < items.length; i++) {
    const h = items[i].kind === 'header' ? HEADER_H : ROW_H
    if (offsets[i] + h < minY) continue
    if (offsets[i] > maxY) break
    visible.push(i)
  }

  return (
    <div
      {...swipe}
      ref={scrollRef}
      onScroll={measure}
      role="complementary"
      aria-label={t('channel.members')}
      className="fc-member-list absolute inset-0 z-10 lg:relative lg:inset-auto lg:z-auto w-full lg:w-60 bg-fc-channel flex-shrink-0 overflow-y-auto overscroll-y-contain p-2 panel-slide-right"
    >
      {/* Header mobile avec fermeture (la liste est un overlay plein écran) */}
      <div className="lg:hidden flex items-center justify-between px-2 py-2 border-b border-fc-bg mb-2">
        <span className="font-semibold text-white text-sm">{t('members.title')}</span>
        <button
          onClick={onClose}
          aria-label={t('members.close')}
          className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-fc-muted hover:text-white rounded hover:bg-fc-hover transition"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      <div className="px-1 pb-2">
        <input
          type="search"
          placeholder={t('members.search')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label={t('members.searchLabel')}
          className="w-full bg-fc-bg/60 text-fc-text placeholder-fc-muted text-xs px-2.5 py-1.5 rounded outline-none focus:ring-1 focus:ring-fc-accent/50 transition"
        />
      </div>
      <div ref={listRef} role="list" aria-label={t('members.title')} style={{ position: 'relative', height: totalHeight }}>
        {visible.map(i => {
          const it = items[i]
          return (
            <div key={it.key} style={{ position: 'absolute', top: offsets[i], left: 0, right: 0 }}>
              {it.kind === 'header' ? (
                <div
                  role="listitem"
                  style={{ height: HEADER_H }}
                  className="px-2 pb-1 flex items-end text-xs font-semibold text-fc-muted uppercase tracking-wide"
                >
                  {it.label}
                </div>
              ) : (
                <MemberRow m={it.m} decor={roleDecor(it.m.user_id)} serverId={serverId} onClick={e => setPopup({ userId: it.m.user_id, x: e.clientX - 356, y: e.clientY })} />
              )}
            </div>
          )
        })}
      </div>
      {query && filteredOnline.length === 0 && filteredOffline.length === 0 && (
        <p className="text-xs text-fc-muted px-2 py-4 text-center">{t('members.noMatch')}</p>
      )}
      {popup && (
        <UserPopup userId={popup.userId} serverId={serverId} anchorX={popup.x} anchorY={popup.y} onClose={() => setPopup(null)} />
      )}
    </div>
  )
}
