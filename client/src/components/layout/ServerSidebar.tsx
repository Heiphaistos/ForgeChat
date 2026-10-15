import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bookmark, Check, GraduationCap, Newspaper, EyeOff, MessageCircle, Plus, Compass, Folder, FolderOpen, X, LayoutTemplate, Settings, LogOut, Copy, UserPlus, Trash2, BellOff, Bell, CheckCheck, Search as SearchIcon } from 'lucide-react'
import { useState, useEffect, useRef, useCallback, useMemo, type CSSProperties } from 'react'
import { accentVars, cleanAppearance, effectiveAppearance, iconRingCss, iconShape, isOptedOut } from '../../lib/serverAppearance'
import { hex } from '../../lib/nameStyle'
import { useLookOptOutTick } from '../../hooks/useServerAppearance'
import DeleteServerModal from '../modals/DeleteServerModal'
import api, { mediaUrl } from '../../api/client'
import toast from 'react-hot-toast'
import { confirm } from '../ui/ConfirmModal'
import ServerNotifModal from '../modals/ServerNotifModal'
import { useAuth } from '../../store/auth'
import { useUnread } from '../../store/unread'
import { useChannelNotif } from '../../store/channelNotif'
import { useMobile } from '../../contexts/MobileContext'
import { createPortal } from 'react-dom'
import { useT, intlLocale, t as tr, type Key } from '../../i18n'
import { FIXED_IDS, moveFixed, resetFixed, setFixedHidden, visibleFixed } from './railFixed'
import { acceptsInto, applyDrop, dissolveFolder, FOLDER_COLORS, newFolderId, topLevel, type Drag, type Folders, type RailLayout, type Target, type Zone } from './railLayout'

// ─── Dossiers (localStorage = cache, le compte fait foi) ─────

function loadFolders(): Folders {
  try {
    const raw = localStorage.getItem('fc_server_folders')
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveFolders(folders: Folders) {
  try { localStorage.setItem('fc_server_folders', JSON.stringify(folders)) } catch { /* cache seulement */ }
}

// ─── ServerSidebar ──────────────────────────────────────────

export default function ServerSidebar() {
  const t = useT()
  const { serverId } = useParams()
  const nav = useNavigate()
  const { pathname } = useLocation()
  const { closeSidebar } = useMobile()
  const isDMs = pathname.startsWith('/friends') || pathname.startsWith('/dms') || pathname.startsWith('/dm')
  const isSaved = pathname.startsWith('/saved')
  const isNews = pathname.startsWith('/news')
  const isTuto = pathname.startsWith('/tutos')
  const isNotif = pathname.startsWith('/notifications')
  const qc = useQueryClient()
  // Re-rendu quand un membre refuse ou réaccepte l'apparence d'un serveur.
  useLookOptOutTick()
  const serverCounts = useUnread(s => s.serverCounts)
  // Non-lus DM = total des counts par canal moins la part attribuée aux serveurs
  const dmUnread = useUnread(s => {
    const total = Object.values(s.counts).reduce((a, b) => a + b, 0)
    const srv = Object.values(s.serverCounts).reduce((a, b) => a + b, 0)
    return Math.max(0, total - srv)
  })
  // Mentions non lues par serveur (pastille rouge chiffrée, même serveur en sourdine)
  const serverMentionCounts = useUnread(s => s.serverMentionCounts)
  const mentionTotal = useUnread(s => Object.values(s.serverMentionCounts).reduce((a, b) => a + b, 0))
  const [showCreate, setShowCreate] = useState(false)
  const [createStep, setCreateStep] = useState<Step>('choice')
  const [folders, setFolders] = useState<Folders>(loadFolders)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; serverId: string
  } | null>(null)
  // Glisser-déposer (comme Discord) : élément tenu et zone survolée (avant / après / dedans).
  const [drag, setDrag] = useState<Drag | null>(null)
  const [hint, setHint] = useState<(Target & { zone: Zone }) | null>(null)
  const [editFolder, setEditFolder] = useState<string | null>(null)
  const [serverOrder, setServerOrder] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('fc_server_order')
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  })
  // Entrées fixes : ordre et masquage (cache local, le compte fait foi via /users/me/server-layout).
  const [fixedPrefs, setFixedPrefs] = useState<{ fixed?: string[]; hidden?: string[] }>(() => {
    try { return JSON.parse(localStorage.getItem('fc_rail_fixed') ?? '{}') || {} } catch { return {} }
  })
  const [fixedDrag, setFixedDrag] = useState<string | null>(null)
  const [fixedHint, setFixedHint] = useState<{ id: string; zone: 'before' | 'after' } | null>(null)
  const [railMenu, setRailMenu] = useState<{ x: number; y: number; id?: string } | null>(null)
  const railMenuRef = useRef<HTMLDivElement>(null)
  const railPressRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const serverLongPressRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const me = useAuth(s => s.user)
  const isServerMuted = useChannelNotif(s => s.isServerMuted)
  const [notifServer, setNotifServer] = useState<{ id: string; name: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  const { data: servers = [] } = useQuery({
    queryKey: ['servers'],
    queryFn: () => api.get('/servers').then(r => r.data),
    staleTime: 30_000,
  })

  // Modèle intégré : le serveur crée toute la structure (POST /servers {template}) ;
  // modèle enregistré ou public : POST /templates/:id/use.
  const createServer = useMutation({
    mutationFn: (payload: { name: string; template?: PickedTemplate | null }) =>
      payload.template?.source === 'saved'
        ? api.post<{ id: string }>(`/templates/${payload.template.id}/use`, { name: payload.name } as Record<string, unknown>)
        : api.post<{ id: string }>('/servers', { name: payload.name, template: payload.template?.id } as Record<string, unknown>),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['servers'] })
      nav(`/servers/${res.data.id}`)
      setShowCreate(false)
      toast.success(t('servers.created'))
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('common.error')),
  })

  // Fermer context menu en cliquant ailleurs
  useEffect(() => {
    if (!contextMenu) return
    const handler = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [contextMenu])

  // Ouverture de la modale de création depuis la palette de commandes
  useEffect(() => {
    const openCreate = () => setShowCreate(true)
    window.addEventListener('forgechat:create-server', openCreate)
    return () => window.removeEventListener('forgechat:create-server', openCreate)
  }, [])

  const persistFolders = useCallback((next: Folders) => {
    setFolders(next)
    saveFolders(next)
  }, [])

  const toggleFolder = (folderId: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }

  // Premier niveau de la barre : serveurs hors dossier et dossiers, dans l'ordre choisi.
  const serverIds = useMemo(() => (servers as { id: string }[]).map(s => s.id), [servers])
  const serverById = useMemo(() => new Map((servers as any[]).map(s => [s.id as string, s])), [servers])
  const entries = useMemo(() => topLevel(serverIds, { order: serverOrder, folders }), [serverIds, serverOrder, folders])

  // Dossiers et ordre synchronisés entre appareils : le serveur fait foi, le localStorage sert de
  // cache hors ligne. Au premier passage sans disposition en ligne, celle de ce navigateur y monte.
  const layoutLoaded = useRef(false)
  useEffect(() => {
    let alive = true
    api.get('/users/me/server-layout').then(({ data }) => {
      if (!alive) return
      if (data && typeof data === 'object') {
        if (data.folders && typeof data.folders === 'object') { setFolders(data.folders); saveFolders(data.folders) }
        const fp = { fixed: Array.isArray(data.fixed) ? data.fixed : undefined, hidden: Array.isArray(data.hidden) ? data.hidden : undefined }
        setFixedPrefs(fp)
        try { localStorage.setItem('fc_rail_fixed', JSON.stringify(fp)) } catch { /* cache seulement */ }
        if (Array.isArray(data.order)) {
          setServerOrder(data.order)
          try { localStorage.setItem('fc_server_order', JSON.stringify(data.order)) } catch { /* cache seulement */ }
        }
      } else {
        // Rien en ligne : la disposition de ce navigateur devient la référence.
        api.put('/users/me/server-layout', { order: serverOrder, folders, ...fixedPrefs }).catch(() => {})
      }
      layoutLoaded.current = true
    }).catch(() => { /* hors ligne : on garde le cache local, sans écraser le serveur */ })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chargement unique au montage
  }, [])
  useEffect(() => {
    if (!layoutLoaded.current) return
    const t = setTimeout(() => {
      api.put('/users/me/server-layout', { order: serverOrder, folders, ...fixedPrefs }).catch(() => toast.error(tr('msg.saveFailed')))
    }, 800)
    return () => clearTimeout(t)
  }, [folders, serverOrder, fixedPrefs])

  const saveServerOrder = useCallback((newOrder: string[]) => {
    setServerOrder(newOrder)
    try { localStorage.setItem('fc_server_order', JSON.stringify(newOrder)) } catch {}
  }, [])

  const applyLayout = useCallback((next: RailLayout) => {
    persistFolders(next.folders)
    saveServerOrder(next.order)
  }, [persistFolders, saveServerOrder])

  const rail: RailLayout = { order: serverOrder, folders, ...fixedPrefs }
  const applyFixed = (next: RailLayout) => {
    const fp = { fixed: next.fixed, hidden: next.hidden }
    setFixedPrefs(fp)
    try { localStorage.setItem('fc_rail_fixed', JSON.stringify(fp)) } catch { /* cache seulement */ }
  }

  useEffect(() => {
    if (!railMenu) return
    const close = (e: Event) => { if (!railMenuRef.current?.contains(e.target as Node)) setRailMenu(null) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setRailMenu(null) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [railMenu])

  const FIXED = {
    dms: { path: '/friends', active: isDMs, label: t('servers.dms'), Icon: MessageCircle, badge: dmUnread, badgeLabel: t(dmUnread > 1 ? 'servers.dmUnread.other' : 'servers.dmUnread.one', { n: dmUnread > 99 ? '99+' : dmUnread }) },
    saved: { path: '/saved', active: isSaved, label: t('servers.saved'), Icon: Bookmark, badge: 0, badgeLabel: '' },
    tutorials: { path: '/tutos', active: isTuto, label: t('tuto.rail'), Icon: GraduationCap, badge: 0, badgeLabel: '' },
    news: { path: '/news', active: isNews, label: t('news.title'), Icon: Newspaper, badge: 0, badgeLabel: '' },
    notifications: { path: '/notifications', active: isNotif, label: t('notifCenter.title'), Icon: Bell, badge: mentionTotal, badgeLabel: t('notifCenter.unread', { n: mentionTotal }) },
  } as const
  const fixedItem = (id: string) => {
    const f = FIXED[id as keyof typeof FIXED]
    if (!f) return null
    const mark = fixedHint?.id === id && fixedDrag !== id
      ? <span aria-hidden className={`pointer-events-none absolute left-1/2 -translate-x-1/2 w-10 h-1 rounded-full bg-fc-accent ${fixedHint.zone === 'before' ? '-top-1.5' : '-bottom-1.5'}`} />
      : null
    return (
      <div
        key={id}
        className={`relative w-full flex items-center justify-center ${fixedDrag === id ? 'opacity-40' : ''}`}
        draggable
        onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); setFixedDrag(id) }}
        onDragOver={e => {
          if (!fixedDrag || fixedDrag === id) return
          e.preventDefault()
          const r = e.currentTarget.getBoundingClientRect()
          const zone = e.clientY - r.top < r.height / 2 ? 'before' : 'after'
          if (fixedHint?.id !== id || fixedHint.zone !== zone) setFixedHint({ id, zone })
        }}
        onDrop={e => {
          e.preventDefault()
          if (fixedDrag && fixedHint) applyFixed(moveFixed(rail, fixedDrag, id, fixedHint.zone))
          setFixedDrag(null); setFixedHint(null)
        }}
        onDragEnd={() => { setFixedDrag(null); setFixedHint(null) }}
        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setRailMenu({ x: e.clientX, y: e.clientY, id }) }}
      >
        {mark}
        <span aria-hidden className={`absolute left-0 w-1 h-9 rounded-r-full bg-white transition-all duration-200 ${f.active ? 'opacity-100' : 'opacity-0 h-0'}`} />
        <button
          onClick={() => { nav(f.path); closeSidebar() }}
          aria-current={f.active ? 'page' : undefined}
          aria-label={f.label}
          className={`min-w-[44px] min-h-[44px] w-12 h-12 rounded-full flex items-center justify-center transition-all hover:rounded-2xl ${f.active ? 'bg-fc-accent rounded-2xl' : 'bg-fc-channel hover:bg-fc-accent'}`}
          title={f.label}
        >
          <f.Icon size={20} className="text-fc-text" />
        </button>
        {f.badge > 0 && (
          <span role="status" aria-label={f.badgeLabel} className="absolute bottom-0 right-2 min-w-[16px] h-4 px-1 bg-fc-red text-white text-[9px] font-bold rounded-full border-2 border-fc-bg flex items-center justify-center">
            <span aria-hidden>{f.badge > 99 ? '99+' : f.badge}</span>
          </span>
        )}
      </div>
    )
  }

  /** Zone survolée : haut / bas = déplacer avant / après, milieu = ranger dans un dossier (ou en créer un). */
  const zoneAt = (e: React.DragEvent, target: Target): Zone => {
    const r = e.currentTarget.getBoundingClientRect()
    const y = (e.clientY - r.top) / r.height
    if (drag && acceptsInto(drag, target)) return y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'into'
    return y < 0.5 ? 'before' : 'after'
  }
  const dndProps = (target: Target, kind: Drag['kind']) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.stopPropagation()
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', target.id)
      setDrag({ kind, id: target.id })
    },
    onDragOver: (e: React.DragEvent) => {
      if (!drag || drag.id === target.id) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      const zone = zoneAt(e, target)
      if (hint?.id !== target.id || hint.zone !== zone || hint.inFolder !== target.inFolder) setHint({ ...target, zone })
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (drag && drag.id !== target.id) applyLayout(applyDrop(serverIds, { order: serverOrder, folders }, drag, target, zoneAt(e, target)))
      setDrag(null)
      setHint(null)
    },
    onDragEnd: () => { setDrag(null); setHint(null) },
  })
  /** Repère visuel de la zone survolée. */
  const dropMark = (target: Target) => {
    if (!hint || hint.id !== target.id || hint.inFolder !== target.inFolder) return null
    if (hint.zone === 'into') return <span aria-hidden className="pointer-events-none absolute inset-0 m-auto w-12 h-12 rounded-2xl ring-2 ring-fc-accent" />
    return <span aria-hidden className={`pointer-events-none absolute left-1/2 -translate-x-1/2 w-10 h-1 rounded-full bg-fc-accent ${hint.zone === 'before' ? '-top-1.5' : '-bottom-1.5'}`} />
  }

  // Ouvre le serveur puis une fenêtre de sa barre des salons (Inviter, Créer un salon).
  const openPanel = (sId: string, what: 'invite' | 'create-channel') => {
    nav(`/servers/${sId}`)
    setTimeout(() => window.dispatchEvent(new CustomEvent('forgechat:open-server-panel', { detail: what })), 350)
    setContextMenu(null)
  }

  // Context menu actions
  const handleContextMenu = (e: React.MouseEvent, sId: string) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, serverId: sId })
  }

  const addToNewFolder = (sId: string) => {
    const folderId = newFolderId()
    const color = FOLDER_COLORS[Object.keys(folders).length % FOLDER_COLORS.length]
    const next: Folders = Object.fromEntries(Object.entries(folders).map(([k, f]) => [k, { ...f, serverIds: f.serverIds.filter(id => id !== sId) }]).filter(([, f]) => (f as { serverIds: string[] }).serverIds.length))
    next[folderId] = { name: t('servers.newFolderName'), color, serverIds: [sId] }
    const order = entries.includes(sId) ? entries.map(id => (id === sId ? folderId : id)) : [...entries, folderId]
    applyLayout({ order, folders: next })
    setExpandedFolders(prev => new Set([...prev, folderId]))
    setEditFolder(folderId)
    setContextMenu(null)
  }

  const addToExistingFolder = (sId: string, folderId: string) => {
    const f = folders[folderId]
    if (!f || f.serverIds.includes(sId)) return
    persistFolders({
      ...folders,
      [folderId]: { ...f, serverIds: [...f.serverIds, sId] },
    })
    setContextMenu(null)
  }

  const removeFromFolder = (sId: string, folderId: string) => {
    const f = folders[folderId]
    if (!f) return
    const newIds = f.serverIds.filter(id => id !== sId)
    const next = { ...folders }
    if (newIds.length === 0) {
      delete next[folderId]
    } else {
      next[folderId] = { ...f, serverIds: newIds }
    }
    persistFolders(next)
  }

  // Trouver dans quel dossier est un serveur
  const getFolderOfServer = (sId: string): string | null => {
    for (const [fid, f] of Object.entries(folders)) {
      if (f.serverIds.includes(sId)) return fid
    }
    return null
  }

  // Fonction de rendu (pas un composant) : redéfinir un composant à chaque rendu remontait l'icône
  // et le navigateur annulait le glisser-déposer dès le premier redessin.
  const serverIcon = (s: any, inFolder?: string) => {
    const target: Target = { kind: 'server', id: s.id, inFolder }
    const muted = isServerMuted(s.id)
    const isActive = serverId === s.id
    const hasUnread = (serverCounts[s.id] ?? 0) > 0 && !isActive && !muted
    // Apparence du serveur : forme et anneau de l'icône, couleur de la pilule des non-lus.
    const look = effectiveAppearance(cleanAppearance(s.look), isOptedOut(s.id))
    const shape = look?.icon_shape ? iconShape(look.icon_shape) : null
    return (
      <div className="relative w-full flex items-center justify-center" {...dndProps(target, 'server')}>
        {dropMark(target)}
        {/* Discord-style active pill indicator */}
        <span
          aria-hidden
          className={`absolute left-0 w-1 rounded-r-full bg-white transition-all duration-200 ${
            isActive ? 'h-9' : hasUnread ? 'h-2.5' : 'h-0 opacity-0'
          }`}
          style={look?.unread_color != null ? { backgroundColor: hex(look.unread_color) } : undefined}
        />
        <span className="inline-flex" style={iconRingCss(look) as CSSProperties | undefined}>
        <button
          key={s.id}
          onClick={() => nav(`/servers/${s.id}`)}
          onMouseEnter={() => {
            if (!isActive) qc.prefetchQuery({
              queryKey: ['server', s.id],
              queryFn: () => api.get(`/servers/${s.id}`).then(r => r.data),
              staleTime: 60_000,
            })
          }}
          onContextMenu={e => handleContextMenu(e, s.id)}
          onTouchStart={e => {
            const { clientX, clientY } = e.touches[0]
            serverLongPressRef.current = setTimeout(() => {
              serverLongPressRef.current = null
              if ('vibrate' in navigator) navigator.vibrate(20)
              setContextMenu({ x: clientX, y: clientY, serverId: s.id })
            }, 500)
          }}
          onTouchEnd={() => { if (serverLongPressRef.current) { clearTimeout(serverLongPressRef.current); serverLongPressRef.current = null } }}
          onTouchCancel={() => { if (serverLongPressRef.current) { clearTimeout(serverLongPressRef.current); serverLongPressRef.current = null } }}
          onTouchMove={() => { if (serverLongPressRef.current) { clearTimeout(serverLongPressRef.current); serverLongPressRef.current = null } }}
          aria-current={isActive ? 'page' : undefined}
          aria-label={s.name}
          className={`w-12 h-12 flex items-center justify-center transition-all font-bold text-white select-none overflow-hidden
            ${shape ? shape.className : `rounded-full hover:rounded-2xl ${isActive ? 'rounded-2xl' : ''}`}
            ${isActive ? 'bg-fc-accent' : 'bg-fc-channel hover:bg-fc-accent'}
            ${drag?.id === s.id ? 'opacity-40' : ''}`}
          style={{ ...(shape?.style as CSSProperties | undefined), ...(accentVars(look) as CSSProperties | undefined) }}
          title={s.name}
        >
          {s.icon
            ? <img src={mediaUrl(s.icon)} alt={s.name} loading="lazy" decoding="async" className="w-full h-full object-cover" />
            : s.name.charAt(0).toUpperCase()}
        </button>
        </span>
        {/* Non-lu = pilule blanche à gauche (ci-dessus) ; mentions = pastille rouge chiffrée */}
        {(serverMentionCounts[s.id] ?? 0) > 0 && (
          <span
            role="status"
            aria-label={tr(serverMentionCounts[s.id] > 1 ? 'sw.rail.mentionsOther' : 'sw.rail.mentionsOne', { n: serverMentionCounts[s.id], name: s.name })}
            className="absolute bottom-0 right-1 min-w-[18px] h-[18px] px-1 bg-fc-red text-white text-[10px] font-bold rounded-full border-2 border-fc-bg flex items-center justify-center"
          >
            <span aria-hidden>{serverMentionCounts[s.id] > 99 ? '99+' : serverMentionCounts[s.id]}</span>
          </span>
        )}
        {muted && !(serverMentionCounts[s.id] > 0) && (
          <span className="absolute bottom-0 right-2 w-3.5 h-3.5 bg-fc-muted/80 rounded-full border-2 border-fc-bg flex items-center justify-center">
            <BellOff size={7} className="text-white" />
          </span>
        )}
      </div>
    )
  }

  return (
    <div
      className="fc-server-rail flex flex-col items-center py-3 w-[72px] bg-fc-bg gap-2 overflow-y-auto overscroll-y-contain relative"
      onContextMenu={e => { if ((e.target as HTMLElement).closest('button')) return; e.preventDefault(); setRailMenu({ x: e.clientX, y: e.clientY }) }}
      onTouchStart={e => {
        if ((e.target as HTMLElement).closest('button')) return
        const { clientX: x, clientY: y } = e.touches[0]
        railPressRef.current = setTimeout(() => { railPressRef.current = null; if ('vibrate' in navigator) navigator.vibrate(20); setRailMenu({ x, y }) }, 500)
      }}
      onTouchEnd={() => { if (railPressRef.current) { clearTimeout(railPressRef.current); railPressRef.current = null } }}
      onTouchMove={() => { if (railPressRef.current) { clearTimeout(railPressRef.current); railPressRef.current = null } }}
    >
      {/* Entrées fixes : masquables (clic droit) et réordonnables (glisser-déposer) */}
      {visibleFixed(rail).map(fixedItem)}

      <div className="w-8 h-px bg-fc-hover mx-auto" />

      {/* Serveurs et dossiers : glisser-déposer comme Discord (haut/bas = déplacer, milieu = dossier) */}
      {entries.map(id => {
        const folder = folders[id]
        if (!folder) {
          const s = serverById.get(id)
          return s ? <div key={id} className="w-full">{serverIcon(s)}</div> : null
        }
        const folderServers = folder.serverIds.map(x => serverById.get(x)).filter(Boolean)
        const isExpanded = expandedFolders.has(id)
        const hasActiveServer = folderServers.some((s: any) => s.id === serverId)
        const target: Target = { kind: 'folder', id }
        return (
          <div key={id} className="flex flex-col items-center gap-1 w-full">
            <div className="relative w-full flex items-center justify-center" {...dndProps(target, 'folder')}>
              {dropMark(target)}
              <button
                onClick={() => toggleFolder(id)}
                onContextMenu={e => { e.preventDefault(); setEditFolder(id) }}
                onTouchStart={() => {
                  serverLongPressRef.current = setTimeout(() => {
                    serverLongPressRef.current = null
                    if ('vibrate' in navigator) navigator.vibrate(20)
                    setEditFolder(id)
                  }, 500)
                }}
                onTouchEnd={() => { if (serverLongPressRef.current) { clearTimeout(serverLongPressRef.current); serverLongPressRef.current = null } }}
                onTouchMove={() => { if (serverLongPressRef.current) { clearTimeout(serverLongPressRef.current); serverLongPressRef.current = null } }}
                className={`relative w-12 h-12 rounded-2xl flex items-center justify-center transition-all
                  ${hasActiveServer ? 'ring-2 ring-fc-accent' : ''} ${drag?.id === id ? 'opacity-40' : ''}
                  hover:brightness-110`}
                style={{ backgroundColor: folder.color + '33', border: `2px solid ${folder.color}` }}
                title={`${folder.name} — ${t('servers.folderHint')}`}
                aria-label={folder.name}
                aria-expanded={isExpanded}
              >
                {isExpanded ? <FolderOpen size={26} style={{ color: folder.color }} /> : <Folder size={26} style={{ color: folder.color }} />}
                <span className="absolute -bottom-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-fc-channel text-[10px] leading-4 text-center font-bold" style={{ color: folder.color, border: `1px solid ${folder.color}` }}>{folderServers.length}</span>
              </button>
            </div>

            {isExpanded && (
              <>
                <button onClick={() => setEditFolder(id)} className="max-w-[66px] truncate text-[10px] font-semibold hover:underline" style={{ color: folder.color }} title={t('servers.editFolder')}>
                  {folder.name}
                </button>
                <div className="flex flex-col items-center gap-1 w-full rounded-2xl py-1" style={{ backgroundColor: folder.color + '1a' }}>
                  {folderServers.map((s: any) => (
                    <div key={s.id} className="relative group w-full">
                      {serverIcon(s, id)}
                      <button
                        onClick={e => { e.stopPropagation(); removeFromFolder(s.id, id) }}
                        className="absolute -top-1 right-2 w-4 h-4 bg-fc-red rounded-full items-center justify-center hidden group-hover:flex"
                        title={t('servers.removeFromFolder')}
                        aria-label={t('servers.removeFromFolder')}
                      >
                        <X size={8} className="text-white" />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )
      })}

      {/* Recherche rapide (QuickSwitcher) — indispensable sur mobile où Ctrl+K n'existe pas */}
      <button
        onClick={() => { window.dispatchEvent(new CustomEvent('forgechat:open-quick-switcher')); closeSidebar() }}
        className="w-12 h-12 bg-fc-channel hover:bg-fc-accent rounded-full flex items-center justify-center transition-all hover:rounded-2xl text-fc-muted hover:text-white"
        title={t('servers.quickSearchTitle')}
        aria-label={t('servers.quickSearch')}
      >
        <SearchIcon size={20} />
      </button>

      {/* Explorer */}
      <button
        onClick={() => { nav('/explore'); closeSidebar() }}
        className="w-12 h-12 bg-fc-channel hover:bg-fc-accent rounded-full flex items-center justify-center transition-all hover:rounded-2xl text-fc-muted hover:text-white"
        title={t('servers.explore')}
        aria-label={t('servers.explore')}
      >
        <Compass size={20} />
      </button>

      {/* Créer serveur */}
      <button
        onClick={() => { setCreateStep('choice'); setShowCreate(true) }}
        className="w-12 h-12 bg-fc-channel hover:bg-fc-green rounded-full flex items-center justify-center transition-all hover:rounded-2xl text-fc-green hover:text-white"
        title={t('servers.create')}
        aria-label={t('servers.create')}
      >
        <Plus size={24} />
      </button>

      {/* Utiliser un template */}
      <button
        onClick={() => { setCreateStep('template-grid'); setShowCreate(true) }}
        className="w-12 h-12 bg-fc-channel hover:bg-fc-accent rounded-full flex items-center justify-center transition-all hover:rounded-2xl text-fc-muted hover:text-white"
        title={t('servers.useTemplate')}
        aria-label={t('servers.createFromTemplate')}
      >
        <LayoutTemplate size={20} />
      </button>

      {/* Menu du vide de la barre / d'une entrée fixe : afficher, masquer, réinitialiser */}
      {railMenu && (
        <div
          ref={railMenuRef}
          role="menu"
          className="fixed z-[100] bg-fc-channel border border-fc-hover rounded-lg shadow-2xl py-1 min-w-[220px]"
          style={{ top: Math.min(railMenu.y, window.innerHeight - 260), left: Math.max(8, Math.min(railMenu.x, window.innerWidth - 230)) }}
        >
          {railMenu.id ? (
            <button role="menuitem" className="w-full text-left px-3 py-1.5 text-sm text-fc-text hover:bg-fc-hover hover:text-white transition flex items-center gap-2"
              onClick={() => { applyFixed(setFixedHidden(rail, railMenu.id!, true)); setRailMenu(null) }}>
              <EyeOff size={14} /> {t('rail.fixed.hide')}
            </button>
          ) : (
            <>
              <div className="px-3 py-1 text-[11px] font-semibold uppercase text-fc-muted">{t('rail.fixed.title')}</div>
              {FIXED_IDS.map(id => {
                const shown = !rail.hidden?.includes(id)
                return (
                  <button key={id} role="menuitemcheckbox" aria-checked={shown} className="w-full text-left px-3 py-1.5 text-sm text-fc-text hover:bg-fc-hover hover:text-white transition flex items-center gap-2"
                    onClick={() => applyFixed(setFixedHidden(rail, id, shown))}>
                    <span className="w-4 flex-shrink-0">{shown && <Check size={14} />}</span> {t('rail.fixed.show', { name: FIXED[id].label })}
                  </button>
                )
              })}
              <div className="h-px bg-fc-hover my-1" />
              <button role="menuitem" className="w-full text-left px-3 py-1.5 text-sm text-fc-text hover:bg-fc-hover hover:text-white transition"
                onClick={() => { applyFixed(resetFixed(rail)); setRailMenu(null) }}>
                {t('rail.fixed.reset')}
              </button>
            </>
          )}
        </div>
      )}

      {/* Context menu clic droit serveur */}
      {contextMenu && (() => {
        const ctxServer = (servers as any[]).find((s: any) => s.id === contextMenu.serverId)
        const isOwner = ctxServer?.owner_id === me?.id
        return (
          <div
            ref={contextMenuRef}
            className="fixed z-[100] bg-fc-channel border border-fc-hover rounded-lg shadow-2xl py-1 min-w-[200px]"
            style={{ top: Math.min(contextMenu.y, window.innerHeight - 280), left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 210)) }}
          >
            {/* Actions serveur */}
            {(serverCounts[contextMenu.serverId] ?? 0) > 0 && (
              <button
                className="w-full text-left px-3 py-1.5 text-sm text-fc-text hover:bg-fc-hover hover:text-white transition flex items-center gap-2"
                onClick={async () => {
                  const sId = contextMenu.serverId
                  setContextMenu(null)
                  try {
                    await api.post(`/servers/${sId}/read`)
                    await useUnread.getState().fetchAll()
                    toast.success(t('servers.markedRead'))
                  } catch {
                    toast.error(t('servers.markReadFailed'))
                  }
                }}
              >
                <CheckCheck size={12} /> {t('servers.markRead')}
              </button>
            )}
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-fc-accent hover:bg-fc-accent hover:text-white transition flex items-center gap-2"
              onClick={() => openPanel(contextMenu.serverId, 'invite')}
            >
              <UserPlus size={12} /> {t('servers.invite')}
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-fc-text hover:bg-fc-hover hover:text-white transition flex items-center gap-2"
              onClick={() => openPanel(contextMenu.serverId, 'create-channel')}
            >
              <Plus size={12} /> {t('servers.createChannel')}
            </button>
            <div className="my-1 border-t border-fc-hover" />
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-fc-text hover:bg-fc-hover hover:text-white transition flex items-center gap-2"
              onClick={() => {
                // Naviguer vers le serveur puis demander à ChannelSidebar d'ouvrir
                // la modale de paramètres (la route /settings n'existe pas → écran noir)
                nav(`/servers/${contextMenu.serverId}`)
                setTimeout(() => window.dispatchEvent(new CustomEvent('forgechat:open-server-settings')), 350)
                setContextMenu(null)
              }}
            >
              <Settings size={12} /> {t('servers.settings')}
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-fc-text hover:bg-fc-hover hover:text-white transition flex items-center gap-2"
              onClick={() => { navigator.clipboard.writeText(contextMenu.serverId); toast.success(t('common.idCopied')); setContextMenu(null) }}
            >
              <Copy size={12} /> {t('servers.copyId')}
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-fc-text hover:bg-fc-hover hover:text-white transition flex items-center gap-2"
              onClick={() => {
                const sv = (servers as { id: string; name: string }[]).find(x => x.id === contextMenu.serverId)
                setNotifServer({ id: contextMenu.serverId, name: sv?.name ?? '' })
                setContextMenu(null)
              }}
            >
              {isServerMuted(contextMenu.serverId) ? <BellOff size={12} /> : <Bell size={12} />} {t('servers.notifSettings')}
            </button>

            {/* Dossiers */}
            <div className="my-1 border-t border-fc-hover" />
            <div className="px-3 py-1 text-xs text-fc-muted font-semibold uppercase tracking-wide">
              {t('servers.folders')}
            </div>
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-fc-text hover:bg-fc-hover hover:text-white transition flex items-center gap-2"
              onClick={() => addToNewFolder(contextMenu.serverId)}
            >
              <Plus size={12} /> {t('servers.newFolder')}
            </button>
            {Object.entries(folders).map(([fid, f]) => (
              <button
                key={fid}
                className="w-full text-left px-3 py-1.5 text-sm text-fc-text hover:bg-fc-hover hover:text-white transition flex items-center gap-2"
                onClick={() => addToExistingFolder(contextMenu.serverId, fid)}
              >
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: f.color }} />
                {t('servers.addToFolder', { name: f.name })}
              </button>
            ))}
            {getFolderOfServer(contextMenu.serverId) && (
              <button
                className="w-full text-left px-3 py-1.5 text-sm text-fc-red hover:bg-fc-red/10 transition flex items-center gap-2"
                onClick={() => {
                  const fid = getFolderOfServer(contextMenu.serverId)!
                  removeFromFolder(contextMenu.serverId, fid)
                  setContextMenu(null)
                }}
              >
                <X size={12} /> {t('servers.removeFromFolder')}
              </button>
            )}

            {/* Quitter */}
            {!isOwner && (
              <>
                <div className="my-1 border-t border-fc-hover" />
                <button
                  className="w-full text-left px-3 py-1.5 text-sm text-fc-red hover:bg-fc-red/10 transition flex items-center gap-2"
                  onClick={async () => {
                    if (await confirm({ message: t('servers.leaveConfirm', { name: ctxServer?.name ?? '' }), danger: true, confirmLabel: t('servers.leave') })) {
                      try {
                        await api.post(`/servers/${contextMenu.serverId}/leave`)
                        qc.invalidateQueries({ queryKey: ['servers'] })
                        nav('/friends')
                      } catch {
                        toast.error(t('servers.leaveFailed'))
                      }
                    }
                    setContextMenu(null)
                  }}
                >
                  <LogOut size={12} /> {t('servers.leaveServer')}
                </button>
              </>
            )}
            {isOwner && ctxServer && (
              <>
                <div className="my-1 border-t border-fc-hover" />
                <button
                  className="w-full text-left px-3 py-1.5 text-sm text-fc-red hover:bg-fc-red/10 transition flex items-center gap-2"
                  onClick={() => { setDeleteTarget({ id: ctxServer.id, name: ctxServer.name }); setContextMenu(null) }}
                >
                  <Trash2 size={12} /> {t('servers.delete')}
                </button>
              </>
            )}
          </div>
        )
      })()}
      {deleteTarget && <DeleteServerModal server={deleteTarget} onClose={() => setDeleteTarget(null)} />}
      {editFolder && folders[editFolder] && (
        <FolderEditModal
          folder={folders[editFolder]}
          onSave={(name, color) => { persistFolders({ ...folders, [editFolder]: { ...folders[editFolder], name, color } }); setEditFolder(null) }}
          onDissolve={() => { applyLayout(dissolveFolder(serverIds, { order: serverOrder, folders }, editFolder)); setEditFolder(null) }}
          onClose={() => setEditFolder(null)}
        />
      )}

      {showCreate && (
        <CreateServerModal
          onClose={() => setShowCreate(false)}
          onCreate={(name, template) => createServer.mutate({ name, template })}
          isPending={createServer.isPending}
          initialStep={createStep}
        />
      )}

      {notifServer && (
        <ServerNotifModal serverId={notifServer.id} serverName={notifServer.name} onClose={() => setNotifServer(null)} />
      )}
    </div>
  )
}

// ─── CreateServerModal avec templates ──────────────────────

type Step = 'choice' | 'template-grid' | 'name'

/** Modèle choisi : intégré (créé par le serveur) ou enregistré/public. */
interface PickedTemplate {
  id: string
  source: 'builtin' | 'saved'
  name: string
  description: string
  template_data: any
}

function CreateServerModal({
  onClose,
  onCreate,
  isPending,
  initialStep = 'choice',
}: {
  onClose: () => void
  onCreate: (name: string, template?: PickedTemplate | null) => void
  isPending: boolean
  initialStep?: Step
}) {
  const t = useT()
  const nav = useNavigate()
  const [step, setStep] = useState<Step>(initialStep)
  const [name, setName] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<PickedTemplate | null>(null)

  // Modèles intégrés (structure tenue par le serveur), publics et personnels.
  const { data: remoteTemplates } = useQuery<{ builtin?: { id: string; template_data: any }[]; public: any[]; mine: any[] }>({
    queryKey: ['server-templates'],
    queryFn: () => api.get('/templates').then(r => r.data),
    enabled: step === 'template-grid',
  })

  const allPublicTemplates: PickedTemplate[] = [
    ...(remoteTemplates?.builtin ?? []).map(b => ({
      id: b.id,
      source: 'builtin' as const,
      name: t(`tpl.${b.id}` as Key),
      description: t(`tpl.${b.id}.desc` as Key),
      template_data: b.template_data,
    })),
    ...(remoteTemplates?.public ?? []).map((tp: any) => ({
      id: tp.id,
      source: 'saved' as const,
      name: tp.name,
      description: tp.description ?? t('servers.create.used', { n: tp.usage_count }),
      template_data: tp.template_data,
    })),
  ]

  const myRemoteTemplates: PickedTemplate[] = (remoteTemplates?.mine ?? []).map((tp: any) => ({
    id: tp.id,
    source: 'saved' as const,
    name: tp.name,
    description: tp.description ?? t('servers.create.createdOn', { date: new Date(tp.created_at).toLocaleDateString(intlLocale()) }),
    template_data: tp.template_data,
  }))

  const handleCreate = () => {
    if (!name.trim()) return
    onCreate(name.trim(), selectedTemplate)
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4" onClick={onClose}>
      <div
        className={`bg-fc-channel rounded-xl shadow-2xl w-full max-h-[90dvh] overflow-y-auto ${step === 'template-grid' ? 'md:w-[560px]' : 'md:w-[400px]'}`}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('servers.create.title')}
      >
        {/* ── Étape 1 : Choix ── */}
        {step === 'choice' && (
          <div className="p-6">
            <h2 className="text-xl font-bold text-white mb-1 text-center">{t('servers.create.title')}</h2>
            <p className="text-fc-muted text-sm mb-6 text-center">
              {t('servers.create.intro')}
            </p>
            <div className="space-y-3">
              <button
                onClick={() => { setSelectedTemplate(null); setStep('name') }}
                className="w-full p-4 bg-fc-bg hover:bg-fc-hover rounded-lg text-left transition group"
              >
                <div className="font-semibold text-white group-hover:text-fc-accent transition">
                  {t('servers.create.scratch')}
                </div>
                <div className="text-xs text-fc-muted mt-0.5">
                  {t('servers.create.scratchDesc')}
                </div>
              </button>
              <button
                onClick={() => setStep('template-grid')}
                className="w-full p-4 bg-fc-bg hover:bg-fc-hover rounded-lg text-left transition group"
              >
                <div className="font-semibold text-white group-hover:text-fc-accent transition">
                  {t('servers.create.fromTemplate')}
                </div>
                <div className="text-xs text-fc-muted mt-0.5">
                  {t('servers.create.fromTemplateDesc')}
                </div>
              </button>
              <button
                onClick={() => { onClose(); nav('/import-discord') }}
                className="w-full p-4 bg-fc-bg hover:bg-fc-hover rounded-lg text-left transition group"
              >
                <div className="font-semibold text-white group-hover:text-fc-accent transition">
                  {t('servers.create.import')}
                </div>
                <div className="text-xs text-fc-muted mt-0.5">
                  {t('servers.create.importDesc')}
                </div>
              </button>
            </div>
            <button onClick={onClose} className="mt-4 w-full py-2 text-fc-muted hover:text-white text-sm transition">
              {t('common.cancel')}
            </button>
          </div>
        )}

        {/* ── Étape 2 : Grille templates ── */}
        {step === 'template-grid' && (
          <div className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <button onClick={() => setStep('choice')} aria-label={t('common.back')} className="text-fc-muted hover:text-white transition">
                ←
              </button>
              <h2 className="text-lg font-bold text-white">{t('servers.create.chooseTemplate')}</h2>
            </div>

            {/* Templates publics / built-in */}
            <div className="mb-4">
              <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">{t('servers.create.public')}</div>
              <div className="grid grid-cols-2 gap-2 max-h-[260px] overflow-y-auto overscroll-contain pr-1">
                {allPublicTemplates.map(tp => (
                  <button
                    key={tp.id}
                    onClick={() => { setSelectedTemplate(tp); setStep('name') }}
                    className="p-3 bg-fc-bg hover:bg-fc-hover rounded-lg text-left transition group border border-transparent hover:border-fc-accent/40"
                  >
                    <div className="font-medium text-white text-sm group-hover:text-fc-accent transition">{tp.name}</div>
                    <div className="text-xs text-fc-muted mt-0.5 leading-snug line-clamp-2">{tp.description}</div>
                    <div className="text-[10px] text-fc-muted/60 mt-1">
                      {tp.template_data.channels?.length
                        ? t('servers.create.channels', { n: tp.template_data.channels.length })
                        : t('community.tpl.categoriesOnly', { n: tp.template_data.categories?.length ?? 0 })}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Mes templates perso */}
            {myRemoteTemplates.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">{t('servers.create.mine')}</div>
                <div className="grid grid-cols-2 gap-2 max-h-[160px] overflow-y-auto overscroll-contain pr-1">
                  {myRemoteTemplates.map(tp => (
                    <button
                      key={tp.id}
                      onClick={() => { setSelectedTemplate(tp); setStep('name') }}
                      className="p-3 bg-fc-bg hover:bg-fc-hover rounded-lg text-left transition group border border-transparent hover:border-fc-accent/40"
                    >
                      <div className="font-medium text-white text-sm group-hover:text-fc-accent transition">{tp.name}</div>
                      <div className="text-xs text-fc-muted mt-0.5 line-clamp-2">{tp.description}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Étape 3 : Nom ── */}
        {step === 'name' && (
          <div className="p-6">
            <div className="flex items-center gap-2 mb-1">
              <button onClick={() => setStep(selectedTemplate ? 'template-grid' : 'choice')} aria-label={t('common.back')} className="text-fc-muted hover:text-white transition">
                ←
              </button>
              <h2 className="text-xl font-bold text-white">
                {selectedTemplate ? t('servers.create.template', { name: selectedTemplate.name }) : t('servers.create.scratch')}
              </h2>
            </div>
            {selectedTemplate && (
              <p className="text-xs text-fc-muted mb-3 ml-6">
                {selectedTemplate.template_data.channels?.length
                  ? t('servers.create.willCreate', { n: selectedTemplate.template_data.channels.length })
                  : t('community.tpl.categoriesOnly', { n: selectedTemplate.template_data.categories?.length ?? 0 })}
              </p>
            )}
            <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1 mt-3">
              {t('servers.create.name')}
            </label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('servers.create.namePlaceholder')}
              maxLength={100}
              enterKeyHint="done"
              autoCapitalize="sentences"
              className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent mb-4"
              onKeyDown={e => e.key === 'Enter' && name.trim() && handleCreate()}
            />
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 text-fc-muted hover:text-white transition">
                {t('common.cancel')}
              </button>
              <button
                onClick={handleCreate}
                disabled={!name.trim() || isPending}
                className="px-4 py-2 bg-fc-accent hover:bg-indigo-500 disabled:opacity-50 text-white rounded transition"
              >
                {isPending ? t('common.creating') : t('common.create')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Renommer un dossier de serveurs, changer sa couleur, ou le défaire (ses serveurs reprennent sa place). */
function FolderEditModal({ folder, onSave, onDissolve, onClose }: {
  folder: { name: string; color: string }
  onSave: (name: string, color: string) => void
  onDissolve: () => void
  onClose: () => void
}) {
  const t = useT()
  const [name, setName] = useState(folder.name)
  const [color, setColor] = useState(folder.color)
  const save = () => onSave(name.trim().slice(0, 32) || folder.name, color)
  // Portail vers <body> : la barre des serveurs fixe le repère des éléments `fixed`.
  return createPortal(
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="folder-edit-title" onClick={e => e.stopPropagation()}
        className="bg-fc-channel rounded-xl w-full max-w-sm shadow-2xl p-5 space-y-4">
        <h2 id="folder-edit-title" className="text-lg font-semibold text-white">{t('servers.editFolder')}</h2>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-fc-muted uppercase tracking-wide">{t('servers.folderName')}</span>
          <input autoFocus value={name} maxLength={32} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onClose() }}
            onFocus={e => e.currentTarget.select()}
            className="w-full px-3 py-2 bg-fc-input rounded-lg text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm" />
        </label>
        <div className="space-y-1">
          <span className="text-xs font-semibold text-fc-muted uppercase tracking-wide">{t('servers.folderColor')}</span>
          <div className="flex flex-wrap gap-2 items-center">
            {FOLDER_COLORS.map(c => (
              <button key={c} onClick={() => setColor(c)} aria-label={c} aria-pressed={color.toLowerCase() === c.toLowerCase()}
                className={`w-7 h-7 rounded-full transition ${color.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-white ring-offset-2 ring-offset-fc-channel scale-110' : 'opacity-80 hover:opacity-100'}`}
                style={{ backgroundColor: c }} />
            ))}
            <input type="color" value={color} onChange={e => setColor(e.target.value)} aria-label={t('catStyle.custom')} className="w-7 h-7 rounded bg-transparent cursor-pointer" />
          </div>
        </div>
        <div className="flex items-center justify-between pt-1">
          <button onClick={onDissolve} className="text-sm text-fc-red hover:underline">{t('servers.dissolveFolder')}</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-2 text-sm text-fc-muted hover:text-white">{t('common.cancel')}</button>
            <button onClick={save} className="px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-sm font-medium">{t('common.save')}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
