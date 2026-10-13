// En-tête du serveur et menu déroulant de son nom (en haut de la liste des salons), comme Discord. Reprend les
// entrées du clic droit du rail et ajoute catégorie, événements, fils, confidentialité, infos…
import { useState, type CSSProperties } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bell, CalendarPlus, ChevronDown, Copy, EyeOff, FolderPlus, Info, Lock, MessagesSquare, Palette, Plus, Bot,
  Settings, Shield, ShieldCheck, Sparkles, Tag, UserCircle, UserPlus, CheckCheck,
} from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import api, { mediaUrl } from '../../api/client'
import { useUnread } from '../../store/unread'
import { useMyUxPrefs, useUxPrefs } from '../../store/uxPrefs'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useMobile } from '../../contexts/MobileContext'
import { intlLocale, useT } from '../../i18n'
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu'
import { useServerMenuExtras } from '../community/ServerMenuExtras'
import ServerNotifModal from '../modals/ServerNotifModal'
import ServerBoostBanner from '../server/ServerBoostBanner'
import type { ServerSettingsTab } from '../modals/ServerSettingsModal'
import ProfileBanner from '../ui/ProfileBanner'
import ServerIcon from '../ui/ServerIcon'
import StyledNameText from '../ui/StyledNameText'
import { useServerAppearance } from '../../hooks/useServerAppearance'
import { accentFill, bannerBounds, bannerFocus, bannerOverlayCss } from '../../lib/serverAppearance'

interface ServerData {
  server?: { id: string; name: string; owner_id: string; created_at: string; member_count?: number; banner?: string | null; icon?: string | null }
  boost_level?: number
  boost_count?: number
  member_count?: number
  channels?: unknown[]
  roles?: unknown[]
  lockdown?: boolean
  member?: { has_onboarding?: boolean }
}

export interface ServerMenuOpeners {
  invite(): void
  createChannel(): void
  settings(tab: ServerSettingsTab): void
  look(): void
  onboarding(): void
}

function ServerInfoModal({ data, onClose }: { data: ServerData; onClose: () => void }) {
  const t = useT()
  useEscapeKey(onClose)
  const s = data.server
  const { data: owner } = useQuery<{ username: string }>({
    queryKey: ['user', s?.owner_id],
    queryFn: () => api.get(`/users/${s?.owner_id}`).then(r => r.data),
    enabled: !!s?.owner_id,
    staleTime: 60_000,
  })
  if (!s) return null
  const rows: [string, string][] = [
    [t('sm.info.created'), new Date(s.created_at).toLocaleDateString(intlLocale(), { dateStyle: 'long' })],
    [t('sm.info.owner'), owner?.username ?? '…'],
    [t('sm.info.members'), String(s.member_count ?? '?')],
    [t('sm.info.channels'), String(data.channels?.length ?? 0)],
    [t('sm.info.roles'), String(data.roles?.length ?? 0)],
    [t('sm.info.id'), s.id],
  ]
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label={t('sm.info')}
        className="relative bg-fc-sidebar border border-white/10 rounded-xl shadow-2xl p-5 w-full max-w-sm">
        <h3 className="text-white font-semibold mb-3 truncate">{s.name}</h3>
        <dl className="space-y-2 text-sm mb-4">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="text-fc-muted">{k}</dt>
              <dd className="text-fc-text text-right break-all select-text">{v}</dd>
            </div>
          ))}
        </dl>
        <button onClick={onClose} className="w-full btn-primary text-sm py-2">{t('common.close')}</button>
      </div>
    </div>
  )
}

/** En-tête du serveur (bannière, nom, boost) et son menu déroulant. */
export default function ServerHeader({ serverId, data, isAdmin, canCreate, open }: {
  serverId: string
  data: ServerData | undefined
  isAdmin: boolean
  canCreate: boolean
  open: ServerMenuOpeners
}) {
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const onClose = () => setMenuAt(null)
  const t = useT()
  const look = useServerAppearance(serverId)
  const nav = useNavigate()
  const qc = useQueryClient()
  const { channelId } = useParams()
  const [modal, setModal] = useState<'notif' | 'info' | null>(null)
  const unread = useUnread(s => s.serverCounts[serverId] ?? 0)
  const hideMuted = useMyUxPrefs().hideMuted.includes(serverId)
  const { closeSidebar } = useMobile()
  const extras = useServerMenuExtras(serverId, !!data?.lockdown, closeSidebar)
  const { data: settings } = useQuery<{ dm_from_all?: boolean }>({
    queryKey: ['user-settings'],
    queryFn: () => api.get('/user/settings').then(r => r.data),
    enabled: !!menuAt,
    staleTime: 60_000,
  })
  const dmFromAll = settings?.dm_from_all ?? true
  const name = data?.server?.name ?? ''

  const items: ContextMenuEntry[] = [
    ...(unread > 0 ? [{
      label: t('servers.markRead'), icon: <CheckCheck size={16} />,
      onClick: () => {
        api.post(`/servers/${serverId}/read`).then(() => useUnread.getState().fetchAll()).catch(() => toast.error(t('servers.markReadFailed')))
      },
    }] : []),
    { label: t('channels.invite'), icon: <UserPlus size={16} />, onClick: open.invite },
    { separator: true },
    { label: t('servers.settings'), icon: <Settings size={16} />, onClick: () => open.settings('general') },
    ...(isAdmin ? [
      { label: t('sm.permissions'), icon: <Shield size={16} />, onClick: () => open.settings('roles') },
      { label: t('sm.apps'), icon: <Bot size={16} />, onClick: () => open.settings('bots') },
    ] : []),
    { label: t('serverLook.title'), icon: <Palette size={16} />, onClick: open.look },
    ...(canCreate ? [
      { label: t('channels.create'), icon: <Plus size={16} />, onClick: open.createChannel },
      {
        label: t('sm.createCategory'), icon: <FolderPlus size={16} />,
        onClick: () => {
          const n = window.prompt(t('sm.categoryName'))?.trim()
          if (!n) return
          api.post(`/servers/${serverId}/categories`, { name: n.slice(0, 100) })
            .then(() => { qc.invalidateQueries({ queryKey: ['categories', serverId] }); toast.success(t('sm.categoryCreated')) })
            .catch(e => toast.error(e?.response?.data?.error ?? t('common.error')))
        },
      },
    ] : []),
    { label: t('sm.createEvent'), icon: <CalendarPlus size={16} />, onClick: () => open.settings('events') },
    ...(channelId ? [{
      label: t('sm.threads'), icon: <MessagesSquare size={16} />,
      onClick: () => window.dispatchEvent(new CustomEvent('forgechat:open-threads')),
    }] : []),
    ...extras,
    ...(data?.member?.has_onboarding ? [{ label: t('channels.onboarding'), icon: <Sparkles size={16} />, onClick: open.onboarding }] : []),
    { separator: true },
    { label: t('servers.notifSettings'), icon: <Bell size={16} />, onClick: () => setModal('notif') },
    {
      label: t('sm.privacy'), icon: <Lock size={16} />,
      submenu: [{
        label: t('sm.allowDms'), hint: t('sm.allowDmsHint'), checked: dmFromAll,
        onClick: () => {
          api.put('/user/settings', { dm_from_all: !dmFromAll })
            .then(() => { qc.invalidateQueries({ queryKey: ['user-settings'] }); toast.success(t('common.saved')) })
            .catch(() => toast.error(t('common.error')))
        },
      }],
    },
    {
      label: t('sm.hideMuted'), icon: <EyeOff size={16} />, checked: hideMuted,
      onClick: () => useUxPrefs.getState().set('hideMuted', serverId, !hideMuted),
    },
    { label: t('sm.myProfile'), icon: <UserCircle size={16} />, onClick: () => open.settings('profile') },
    ...(isAdmin ? [{ label: t('sm.tag'), icon: <Tag size={16} />, onClick: () => open.settings('tags') }] : []),
    { separator: true },
    { label: t('sm.info'), icon: <Info size={16} />, onClick: () => setModal('info') },
    {
      label: t('sm.copyId'), icon: <Copy size={16} />,
      onClick: () => { void navigator.clipboard.writeText(serverId).then(() => toast.success(t('common.idCopied'))) },
    },
    ...(isAdmin ? [{ label: t('channels.admin'), icon: <ShieldCheck size={16} />, onClick: () => { nav(`/servers/${serverId}/admin`); closeSidebar() } }] : []),
  ]

  const server = data?.server
  const bounds = bannerBounds(look?.banner)
  const overlay = bannerOverlayCss(look?.banner, look?.accent) as CSSProperties | undefined
  const fill = accentFill(look)
  return (
    <>
    <div className="relative">
      <button
        // Sans ceci, le clic qui referme le menu le rouvrirait aussitôt.
        onMouseDown={e => { if (menuAt) e.stopPropagation() }}
        onClick={e => {
          const r = e.currentTarget.getBoundingClientRect()
          setMenuAt(menuAt ? null : { x: r.left + 8, y: r.bottom + 4 })
        }}
        className="w-full shadow-sm border-b border-fc-bg/50 hover:brightness-110 transition overflow-hidden"
        aria-label={menuAt ? t('channels.closeMenu') : t('channels.openMenu')}
        aria-expanded={!!menuAt}
      >
        {server?.banner && mediaUrl(server.banner) ? (
          // Bannière entière, à ses proportions (bornées selon le mode choisi), jamais rognée ;
          // le nom passe sur le voile choisi dans l'apparence du serveur.
          <ProfileBanner src={server.banner} minHeight={bounds.min} maxHeight={bounds.max} focus={bannerFocus(look?.banner)}>
            {overlay && <div aria-hidden className="absolute inset-0 pointer-events-none" style={overlay} />}
            <div className="absolute inset-0 flex items-end justify-between px-4 py-2">
              <StyledNameText text={server.name} style={look?.name ?? null} className="font-semibold text-white text-sm truncate drop-shadow" />
              <ChevronDown size={16} className="text-white/80 flex-shrink-0" />
            </div>
          </ProfileBanner>
        ) : server?.icon ? (
          <div className="relative h-16">
            <img src={mediaUrl(server.icon)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/40" />
            <div className="absolute inset-0 flex items-end justify-between px-4 py-2">
              <StyledNameText text={server.name} style={look?.name ?? null} className="font-semibold text-white text-sm truncate drop-shadow" />
              <ChevronDown size={16} className="text-white/80 flex-shrink-0" />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 px-4 py-3" style={fill ? { background: fill } : undefined}>
            <ServerIcon name={server?.name ?? '?'} look={look} size={32} />
            <StyledNameText text={server?.name ?? '...'} style={look?.name ?? null} className="font-semibold text-white truncate flex-1 text-left" />
            <ChevronDown size={16} className={`${fill ? 'text-white/80' : 'text-fc-muted'} flex-shrink-0`} />
          </div>
        )}
      </button>

      <BoostButton serverId={serverId} />

      {(data?.boost_level ?? 0) > 0 && (
        <ServerBoostBanner
          boostLevel={data?.boost_level ?? 0}
          boostCount={data?.boost_count ?? 0}
          memberCount={data?.member_count ?? 0}
        />
      )}
      {menuAt && <ContextMenu x={menuAt.x} y={menuAt.y} items={items} onClose={onClose} />}
    </div>
      {modal === 'notif' && <ServerNotifModal serverId={serverId} serverName={name} onClose={() => setModal(null)} />}
      {modal === 'info' && data && <ServerInfoModal data={data} onClose={() => setModal(null)} />}
    </>
  )
}

function BoostButton({ serverId }: { serverId: string }) {
  const t = useT()
  const qc = useQueryClient()
  const boost = useMutation({
    mutationFn: () => api.post(`/servers/${serverId}/boost`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['server', serverId] })
      qc.invalidateQueries({ queryKey: ['channels', serverId] })
    },
    onError: () => toast.error(t('channels.boostFailed')),
  })
  return (
    <button
      onClick={() => boost.mutate()}
      disabled={boost.isPending}
      className="mx-2 mb-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg
        text-xs font-semibold text-purple-300 border border-purple-500/30 bg-purple-500/10
        hover:bg-purple-500/20 hover:border-purple-500/60 transition disabled:opacity-50"
    >
      {t('channels.boost')}
    </button>
  )
}

