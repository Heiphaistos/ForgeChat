// Liste des conversations privées (hors serveur) : épinglées, groupes, MP, archivées ; clic droit
// = menu de la conversation (+ menu de la personne pour un MP), comme Discord.
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, BellOff, ChevronRight, Pencil, Pin, Plus, Users, X } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../api/client'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useMobile } from '../../contexts/MobileContext'
import { usePresence } from '../../store/presence'
import { useUnread } from '../../store/unread'
import { useWs } from '../../store/ws'
import { useChat, useDraft } from '../../store/chat'
import { fetchDmMessages } from '../../e2e/dmMessages'
import { stripMarkdown } from '../../utils/mdShortcuts'
import { t as tr, useT } from '../../i18n'
import { useContextMenu, longPress, type ContextMenuEntry } from '../ui/ContextMenu'
import { confirm } from '../ui/ConfirmModal'
import AnimatedImg from '../ui/AnimatedImg'
import UserName from '../ui/UserName'
import { userMenuProps } from '../userMenu/store'
import { buildConvMenu } from '../userMenu/model'
import { dmsQuery, type DmRow } from '../userMenu/queries'

// Couleurs de présence enrichies (online/idle/dnd/invisible/offline)
const PRESENCE_COLOR: Record<string, string> = {
  online: 'bg-fc-green',
  idle: 'bg-fc-yellow',
  dnd: 'bg-fc-red',
  invisible: 'bg-fc-muted',
  offline: 'bg-fc-muted',
}

// Modal léger pour créer un groupe DM
function CreateGroupModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [selected, setSelected] = useState<{ id: string; username: string }[]>([])
  const qc = useQueryClient()
  const nav = useNavigate()
  useEscapeKey(onClose)

  const { data: friends = [] } = useQuery({
    queryKey: ['friends-dm-search', deferredSearch],
    queryFn: () => api.get('/friends', { params: { q: deferredSearch } }).then(r => r.data),
    staleTime: 10_000,
  })

  const create = useMutation({
    mutationFn: () =>
      api.post('/dms/group', { user_ids: selected.map(u => u.id) }).then(r => r.data),
    onSuccess: (dm: any) => {
      qc.invalidateQueries({ queryKey: ['dms'] })
      nav(`/dms/groups/${dm.dm_id ?? dm.id}`)
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('group.createError')),
  })

  const toggle = (u: { id: string; username: string }) => {
    setSelected(prev =>
      prev.find(x => x.id === u.id)
        ? prev.filter(x => x.id !== u.id)
        : prev.length < 10 ? [...prev, u] : prev
    )
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="create-group-title" className="bg-fc-channel rounded-xl w-80 shadow-2xl p-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 id="create-group-title" className="font-semibold text-white text-sm">{t('group.title')}</h2>
          <button onClick={onClose} aria-label={t('common.close')} title={t('common.close')} className="text-fc-muted hover:text-white p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-fc-hover transition"><X size={16} aria-hidden /></button>
        </div>

        <input
          className="w-full bg-fc-input text-sm text-white rounded-lg px-3 py-2 mb-3 outline-none placeholder:text-fc-muted"
          placeholder={t('group.search')}
          aria-label={t('group.search')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
          enterKeyHint="search"
          inputMode="search"
          autoCapitalize="none"
          autoComplete="off"
        />

        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {selected.map(u => (
              <span
                key={u.id}
                className="flex items-center gap-1 bg-fc-accent/20 text-fc-accent text-xs px-2 py-0.5 rounded-full"
              >
                {u.username}
                <button onClick={() => toggle(u)} aria-label={t('group.remove', { name: u.username })} title={t('group.remove', { name: u.username })}><X size={10} /></button>
              </span>
            ))}
          </div>
        )}

        <div className="max-h-40 overflow-y-auto overscroll-contain space-y-0.5 mb-3">
          {(friends as any[]).map((f: any) => {
            const uid: string = f.id ?? f.user_id
            const uname: string = f.username
            const isSelected = !!selected.find(x => x.id === uid)
            return (
              <button
                key={uid}
                onClick={() => toggle({ id: uid, username: uname })}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded transition text-left ${
                  isSelected
                    ? 'bg-fc-accent/20 text-white'
                    : 'hover:bg-fc-hover text-fc-muted hover:text-white'
                }`}
              >
                <div className="w-7 h-7 rounded-full bg-fc-accent flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                  {uname.charAt(0).toUpperCase()}
                </div>
                <span className="text-sm">{uname}</span>
              </button>
            )
          })}
          {(friends as any[]).length === 0 && (
            <p className="text-xs text-fc-muted text-center py-2">{t('group.noFriend')}</p>
          )}
        </div>

        <button
          onClick={() => create.mutate()}
          disabled={selected.length < 2 || create.isPending}
          className="w-full py-2 bg-fc-accent hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {create.isPending ? t('common.creating') : t('group.create', { n: selected.length })}
        </button>
      </div>
    </div>
  )
}

// Horodatage relatif compact style Discord : 5m, 2h, 3j, 2sem, 4mois
function timeAgoShort(dateStr: string): string {
  const diffMin = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
  if (diffMin < 1) return tr('time.short.now')
  if (diffMin < 60) return tr('time.short.min', { n: diffMin })
  const h = Math.floor(diffMin / 60)
  if (h < 24) return tr('time.short.hour', { n: h })
  const d = Math.floor(h / 24)
  if (d < 7) return tr('time.short.day', { n: d })
  if (d < 30) return tr('time.short.week', { n: Math.floor(d / 7) })
  return tr('time.short.month', { n: Math.floor(d / 30) })
}

export function TypingDots() {
  const t = useT()
  return (
    <span className="flex gap-0.5 items-center flex-shrink-0" role="status" aria-label={t('common.someoneTyping')}>
      {[0, 150, 300].map(d => (
        <span key={d} aria-hidden className="w-1 h-1 bg-fc-accent rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  )
}


/** Liste des conversations privées (barre latérale hors serveur), avec les menus de type Discord. */
export default function DmList() {
  const t = useT()
  const nav = useNavigate()
  const { pathname } = useLocation()
  const { closeSidebar } = useMobile()
  const qc = useQueryClient()
  const { on: wsOn } = useWs()
  const ctxMenu = useContextMenu()
  const presenceStatuses = usePresence(s => s.statuses)
  const unreadCounts = useUnread(s => s.counts)
  const drafts = useDraft(s => s.drafts)
  const typingMap = useChat(s => s.typing)
  const isTypingIn = (id: string) => Object.keys(typingMap[id] ?? {}).length > 0
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  // Tick minute pour rafraîchir les horodatages relatifs (5m → 6m) sans event
  const [, setTimeTick] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => setTimeTick(n => n + 1), 60_000)
    return () => clearInterval(iv)
  }, [])

  const { data: dms = [], isLoading: dmsLoading } = useQuery(dmsQuery)

  // Rafraîchir la liste DMs quand un GroupDM est créé/renommé/modifié
  useEffect(() => {
    const refresh = () => qc.invalidateQueries({ queryKey: ['dms'] })
    const offs = ['GROUP_DM_CREATE', 'GROUP_DM_RENAME', 'GROUP_DM_MEMBER_LEAVE', 'GROUP_DM_MEMBER_ADD', 'GROUP_DM_MEMBER_REMOVE']
      .map(ev => wsOn(ev, refresh))
    return () => offs.forEach(off => off())
  }, [qc, wsOn])

  const [dmFilter, setDmFilter] = useState('')
  const dmMatches = useCallback((d: DmRow) => {
    if (!dmFilter.trim()) return true
    const q = dmFilter.trim().toLowerCase()
    return (d.username ?? d.name ?? '').toLowerCase().includes(q)
  }, [dmFilter])
  const { pinnedDms, groupDms, individualDms, archivedDms } = useMemo(() => {
    const shown = dms.filter(d => !d.is_archived && dmMatches(d))
    return {
      pinnedDms: shown.filter(d => d.is_pinned),
      groupDms: shown.filter(d => d.is_group && !d.is_pinned),
      individualDms: shown.filter(d => !d.is_group && !d.is_pinned),
      archivedDms: dms.filter(d => d.is_archived && dmMatches(d)),
    }
  }, [dms, dmMatches])
  const [showArchivedDms, setShowArchivedDms] = useState(false)

  const settings = (dmId: string, body: object, done?: string) => {
    api.patch(`/dms/${dmId}/settings`, body)
      .then(() => { qc.invalidateQueries({ queryKey: ['dms'] }); if (done) toast.success(done) })
      .catch(() => toast.error(t('common.error')))
  }
  const pathOf = (dm: DmRow) => (dm.is_group ? `/dms/groups/${dm.id}` : `/dms/${dm.id}`)

  const convMenu = (dm: DmRow, userEntries: ContextMenuEntry[] = []) => buildConvMenu(
    { group: dm.is_group, pinned: !!dm.is_pinned, muted: dm.is_muted, unread: (unreadCounts[dm.id] ?? 0) > 0 },
    {
      markRead: () => {
        useUnread.getState().reset(dm.id)
        api.post(dm.is_group ? `/dms/groups/${dm.id}/read` : `/dms/${dm.id}/read`).catch(() => {})
      },
      pin: on => settings(dm.id, { pinned: on }),
      mute: minutes => settings(dm.id, { muted: true, mute_minutes: minutes }, t('um.muted')),
      unmute: () => settings(dm.id, { muted: false }, t('um.unmuted')),
      archive: () => settings(dm.id, { archived: true }),
      close: () => {
        settings(dm.id, { closed: true })
        if (pathname === pathOf(dm)) nav('/friends')
      },
      leave: async () => {
        if (!await confirm({ message: t('dms.leaveGroupConfirm', { name: dm.name ?? t('dms.group') }), danger: true, confirmLabel: t('servers.leave') })) return
        try {
          await api.post(`/dms/groups/${dm.id}/leave`)
          qc.invalidateQueries({ queryKey: ['dms'] })
          nav('/friends')
        } catch { toast.error(t('dms.leaveGroupFailed')) }
      },
      copyId: () => { void navigator.clipboard.writeText(dm.id).then(() => toast.success(t('common.idCopied'))) },
    },
    t,
    userEntries,
  )

  // MP : menu de la conversation autour du menu utilisateur partagé ; groupe : menu local.
  const menuProps = (dm: DmRow) => dm.is_group || !dm.other_user_id
    ? { onContextMenu: (e: React.MouseEvent) => ctxMenu.open(e, convMenu(dm)), ...longPress((x, y) => ctxMenu.openAt(x, y, convMenu(dm))) }
    : userMenuProps({ userId: dm.other_user_id, username: dm.username ?? '', avatar: dm.avatar, wrap: entries => convMenu(dm, entries) })

  const renderRow = (dm: DmRow) => {
    const path = pathOf(dm)
    const unread = unreadCounts[dm.id] ?? 0
    const statusKey = dm.is_group ? 'offline' : (presenceStatuses[dm.other_user_id ?? ''] ?? dm.status ?? 'offline')
    const presence = statusKey in PRESENCE_COLOR ? statusKey : 'offline'
    const nameCls = `text-sm truncate ${unread > 0 ? 'font-semibold text-white' : 'font-medium text-fc-text'}`
    return (
      <button
        key={dm.id}
        onClick={() => { nav(path); closeSidebar() }}
        onMouseEnter={dm.is_group ? undefined : () => {
          qc.prefetchQuery({
            queryKey: ['dm_messages', dm.id, null],
            // Même forme que DMPage : déchiffrés (des messages bruts s'affichaient vides).
            queryFn: () => fetchDmMessages(dm.id),
            staleTime: 30_000,
          })
        }}
        {...menuProps(dm)}
        aria-current={pathname === path ? 'page' : undefined}
        className="flex items-center gap-2 w-full px-2 py-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"
      >
        <div className="relative flex-shrink-0">
          {dm.is_group ? (
            <div className="w-8 h-8 rounded-full bg-fc-hover flex items-center justify-center text-fc-muted">
              <Users size={16} />
            </div>
          ) : (<>
            <div className="w-8 h-8 rounded-full bg-fc-accent flex items-center justify-center text-sm font-bold text-white overflow-hidden">
              {dm.avatar
                ? <AnimatedImg src={dm.avatar} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                : (dm.username ?? '?').charAt(0).toUpperCase()}
            </div>
            {/* Indicateur de présence coloré (vert/jaune/rouge/gris) */}
            <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-fc-channel ${PRESENCE_COLOR[presence]}`} />
          </>)}
        </div>
        <div className="min-w-0 text-left flex-1">
          <div className="flex items-baseline justify-between gap-1.5">
            {dm.is_group
              ? <span className={nameCls}>{dm.name ?? dm.username ?? t('dms.group')}</span>
              : <UserName userId={dm.other_user_id ?? ''} name={dm.username ?? ''} className={nameCls} />}
            {dm.last_message_at && (
              <span className="text-[10px] text-fc-muted flex-shrink-0" title={new Date(dm.last_message_at).toLocaleString()}>{timeAgoShort(dm.last_message_at)}</span>
            )}
          </div>
          {dm.last_message_content != null ? (
            <div className={`text-xs truncate ${unread > 0 ? 'text-fc-text font-medium' : 'text-fc-muted'}`}>
              {dm.is_group && dm.last_message_author ? `${dm.last_message_author} : ` : ''}{stripMarkdown(dm.last_message_content) || t('common.attachment')}
            </div>
          ) : dm.is_group ? (
            <div className="text-xs truncate text-fc-muted">{t('dms.members', { n: dm.member_count ?? '?' })}</div>
          ) : (
            <div className={`text-xs ${presence === 'online' ? 'text-fc-green' : presence === 'idle' ? 'text-fc-yellow' : presence === 'dnd' ? 'text-fc-red' : 'text-fc-muted'}`}>
              {presence === 'online' ? t('presence.online')
                : presence === 'idle' ? t('presence.idle')
                : presence === 'dnd' ? t('presence.dnd')
                : t('presence.offline')}
            </div>
          )}
        </div>
        {dm.is_pinned && <Pin size={11} className="flex-shrink-0 text-fc-muted/60" aria-label={t('dml.pinned')} />}
        {/* Quelqu'un écrit dans ce DM */}
        {pathname !== path && isTypingIn(dm.id) && <TypingDots />}
        {/* Indicateur brouillon en attente */}
        {!!drafts[dm.id] && pathname !== path && (
          <Pencil size={11} className="text-fc-muted flex-shrink-0" aria-label={t('common.draftPending')} />
        )}
        {/* Indicateur mute */}
        {dm.is_muted && !unread && (
          <BellOff size={13} className="flex-shrink-0 text-fc-muted/50" />
        )}
        {/* Badge non-lus */}
        {unread > 0 && (
          <span role="status" aria-label={t(unread > 1 ? 'common.unread.other' : 'common.unread.one', { n: unread > 99 ? '99+' : unread })} className="flex-shrink-0 min-w-[18px] h-[18px] bg-fc-red text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
            <span aria-hidden>{unread > 99 ? '99+' : unread}</span>
          </span>
        )}
      </button>
    )
  }

  const sectionTitle = (label: string, extra = '') => (
    <div className={`px-2 py-1 text-[10px] font-semibold text-fc-muted uppercase tracking-wide ${extra}`}>{label}</div>
  )

  return (
    <div className="flex-1 overflow-y-auto overscroll-y-contain p-2">
      {/* En-tête + bouton créer groupe */}
      <div className="flex items-center justify-between px-2 py-2">
        <span className="text-xs font-semibold text-fc-muted uppercase tracking-wide">
          {t('dms.title')}
        </span>
        <button
          onClick={() => setShowCreateGroup(true)}
          aria-label={t('dms.newGroup')}
          title={t('dms.newGroup')}
          className="text-fc-muted hover:text-white transition p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-fc-hover"
        >
          <Plus size={15} aria-hidden />
        </button>
      </div>

      {/* Filtre rapide des conversations — sticky pour rester accessible en scrollant */}
      <div className="px-2 pb-2 sticky top-0 z-10 bg-fc-channel">
        <div className="relative">
          <input
            value={dmFilter}
            onChange={e => setDmFilter(e.target.value)}
            placeholder={t('dms.filter')}
            aria-label={t('dms.filterLabel')}
            enterKeyHint="search"
            autoCapitalize="none"
            className="w-full pl-2.5 pr-8 py-1.5 bg-fc-input rounded text-sm text-white placeholder:text-fc-muted outline-none focus:ring-1 focus:ring-fc-accent"
          />
          {dmFilter && (
            <button
              onClick={() => setDmFilter('')}
              aria-label={t('common.clearFilter')}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-fc-muted hover:text-white transition"
            >
              <X size={13} aria-hidden />
            </button>
          )}
        </div>
      </div>

      {/* Conversations épinglées (MP et groupes) */}
      {pinnedDms.length > 0 && (<>
        {sectionTitle(t('dml.pinned'))}
        {pinnedDms.map(renderRow)}
      </>)}

      {/* Groupes DM */}
      {groupDms.length > 0 && (<>
        {sectionTitle(t('dms.groups'), pinnedDms.length > 0 ? 'mt-1' : '')}
        {groupDms.map(renderRow)}
      </>)}

      {/* DMs individuels */}
      {(groupDms.length > 0 || pinnedDms.length > 0) && individualDms.length > 0 && sectionTitle(t('dms.direct'), 'mt-1')}
      {individualDms.map(renderRow)}

      {/* Skeleton au premier chargement de la liste */}
      {dmsLoading && dms.length === 0 && (
        <div className="space-y-2 px-2 py-2 animate-pulse motion-reduce:animate-none" aria-hidden>
          {[70, 45, 60, 52].map((w, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-fc-hover flex-shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-2.5 rounded bg-fc-hover" style={{ width: `${w}%` }} />
                <div className="h-2 rounded bg-fc-hover/60" style={{ width: `${w - 15}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Aucun résultat pour le filtre */}
      {dmFilter.trim() && pinnedDms.length === 0 && groupDms.length === 0 && individualDms.length === 0 && (
        <div className="text-center text-fc-muted text-xs py-4">{t('dms.noMatch')}</div>
      )}

      {/* Conversations archivées — repliées par défaut, désarchivage en un clic */}
      {archivedDms.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowArchivedDms(v => !v)}
            className="flex items-center gap-1 px-2 py-1.5 w-full text-[10px] font-semibold text-fc-muted uppercase tracking-wide hover:text-white transition"
            aria-expanded={showArchivedDms}
          >
            <ChevronRight size={12} className={`transition-transform ${showArchivedDms ? 'rotate-90' : ''}`} />
            {t('dms.archived', { n: archivedDms.length })}
          </button>
          {showArchivedDms && archivedDms.map(dm => (
            <div key={dm.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-fc-hover/50 transition group/arch">
              <button
                onClick={() => { nav(pathOf(dm)); closeSidebar() }}
                className="flex-1 min-w-0 text-left text-sm text-fc-muted hover:text-white truncate transition"
              >
                {dm.is_group ? (dm.name ?? t('dms.group')) : dm.username}
              </button>
              <button
                onClick={() => settings(dm.id, { archived: false }, t('channels.unarchived'))}
                title={t('dms.unarchive')}
                aria-label={t('dms.unarchiveName', { name: dm.is_group ? (dm.name ?? t('dms.theGroup')) : (dm.username ?? '') })}
                className="opacity-100 md:opacity-0 md:group-hover/arch:opacity-100 p-1.5 min-w-[36px] min-h-[36px] flex items-center justify-center text-fc-muted hover:text-white rounded transition flex-shrink-0"
              >
                <Archive size={13} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Modal créer groupe */}
      {showCreateGroup && (
        <CreateGroupModal onClose={() => setShowCreateGroup(false)} />
      )}
      {ctxMenu.node}
    </div>
  )
}
