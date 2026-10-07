import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bookmark, MessageCircle, Plus, Compass, ChevronDown, FolderOpen, X, LayoutTemplate, Settings, LogOut, Copy, UserPlus, Trash2, BellOff, Bell, CheckCheck, Search as SearchIcon } from 'lucide-react'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import DeleteServerModal from '../modals/DeleteServerModal'
import api, { mediaUrl } from '../../api/client'
import toast from 'react-hot-toast'
import { confirm } from '../ui/ConfirmModal'
import ServerNotifModal from '../modals/ServerNotifModal'
import { useAuth } from '../../store/auth'
import { useUnread } from '../../store/unread'
import { useChannelNotif } from '../../store/channelNotif'
import { useMobile } from '../../contexts/MobileContext'
import { useT, intlLocale, type Key } from '../../i18n'

// ─── Types ─────────────────────────────────────────────────

interface ServerFolder {
  name: string
  color: string
  serverIds: string[]
}

interface FoldersMap {
  [folderId: string]: ServerFolder
}

const FOLDER_COLORS = ['#5865F2', '#57F287', '#FEE75C', '#EB459E', '#ED4245', '#FF7A00', '#00B8D9']

// ─── Helpers localStorage ───────────────────────────────────

function loadFolders(): FoldersMap {
  try {
    const raw = localStorage.getItem('fc_server_folders')
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveFolders(folders: FoldersMap) {
  localStorage.setItem('fc_server_folders', JSON.stringify(folders))
}

function genFolderId() {
  return `folder_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
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
  const qc = useQueryClient()
  const serverCounts = useUnread(s => s.serverCounts)
  // Non-lus DM = total des counts par canal moins la part attribuée aux serveurs
  const dmUnread = useUnread(s => {
    const total = Object.values(s.counts).reduce((a, b) => a + b, 0)
    const srv = Object.values(s.serverCounts).reduce((a, b) => a + b, 0)
    return Math.max(0, total - srv)
  })
  // Mentions non lues par serveur (pastille rouge chiffrée, même serveur en sourdine)
  const serverMentionCounts = useUnread(s => s.serverMentionCounts)
  const [showCreate, setShowCreate] = useState(false)
  const [createStep, setCreateStep] = useState<Step>('choice')
  const [folders, setFolders] = useState<FoldersMap>(loadFolders)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; serverId: string
  } | null>(null)
  const [draggedServerId, setDraggedServerId] = useState<string | null>(null)
  const [dragOverSlot, setDragOverSlot] = useState<number | null>(null)
  const [serverOrder, setServerOrder] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('fc_server_order')
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  })
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

  const persistFolders = useCallback((next: FoldersMap) => {
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

  // Construire la liste d'affichage : ids de serveurs dans un dossier
  const serverIdsInFolders = useMemo(
    () => new Set(Object.values(folders).flatMap(f => f.serverIds)),
    [folders]
  )

  // Séquence : serveurs libres + dossiers (en ordre d'insertion)
  const freeServers = useMemo(
    () => (servers as any[]).filter(s => !serverIdsInFolders.has(s.id)),
    [servers, serverIdsInFolders]
  )

  // Serveurs libres ordonnés selon serverOrder (localStorage)
  const orderedFreeServers = useMemo(() => {
    if (!serverOrder.length) return freeServers
    return [...freeServers].sort((a: any, b: any) => {
      const ai = serverOrder.indexOf(a.id)
      const bi = serverOrder.indexOf(b.id)
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
  }, [freeServers, serverOrder])

  // Dossiers et ordre synchronisés entre appareils : le serveur fait foi, le localStorage sert de
  // cache hors ligne. Au premier passage sans disposition en ligne, celle de ce navigateur y monte.
  const layoutLoaded = useRef(false)
  useEffect(() => {
    let alive = true
    api.get('/users/me/server-layout').then(({ data }) => {
      if (!alive) return
      if (data && typeof data === 'object') {
        if (data.folders && typeof data.folders === 'object') { setFolders(data.folders); saveFolders(data.folders) }
        if (Array.isArray(data.order)) {
          setServerOrder(data.order)
          try { localStorage.setItem('fc_server_order', JSON.stringify(data.order)) } catch { /* cache seulement */ }
        }
      } else {
        // Rien en ligne : la disposition de ce navigateur devient la référence.
        api.put('/users/me/server-layout', { order: serverOrder, folders }).catch(() => {})
      }
      layoutLoaded.current = true
    }).catch(() => { /* hors ligne : on garde le cache local, sans écraser le serveur */ })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chargement unique au montage
  }, [])
  useEffect(() => {
    if (!layoutLoaded.current) return
    const t = setTimeout(() => {
      api.put('/users/me/server-layout', { order: serverOrder, folders }).catch(() => {})
    }, 800)
    return () => clearTimeout(t)
  }, [folders, serverOrder])

  const saveServerOrder = useCallback((newOrder: string[]) => {
    setServerOrder(newOrder)
    try { localStorage.setItem('fc_server_order', JSON.stringify(newOrder)) } catch {}
  }, [])

  // Drop sur un slot (séparateur entre serveurs) = réordonnement
  const handleSlotDragOver = useCallback((e: React.DragEvent, slotIndex: number) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setDragOverSlot(slotIndex)
  }, [])

  const handleSlotDrop = useCallback((e: React.DragEvent, slotIndex: number) => {
    e.preventDefault()
    e.stopPropagation()
    if (!draggedServerId) { setDragOverSlot(null); return }
    const current = orderedFreeServers.filter((s: any) => s.id !== draggedServerId)
    const insertIdx = Math.min(slotIndex, current.length)
    current.splice(insertIdx, 0, orderedFreeServers.find((s: any) => s.id === draggedServerId)!)
    saveServerOrder(current.filter(Boolean).map((s: any) => s.id))
    setDraggedServerId(null)
    setDragOverSlot(null)
  }, [draggedServerId, orderedFreeServers, saveServerOrder])

  const handleSlotDragLeave = useCallback(() => {
    setDragOverSlot(null)
  }, [])

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
    const folderId = genFolderId()
    const color = FOLDER_COLORS[Math.floor(Math.random() * FOLDER_COLORS.length)]
    persistFolders({
      ...folders,
      [folderId]: { name: 'Nouveau dossier', color, serverIds: [sId] },
    })
    setExpandedFolders(prev => new Set([...prev, folderId]))
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

  // Drag & drop — drop sur un autre serveur libre → crée dossier
  const handleDragStart = (sId: string) => {
    setDraggedServerId(sId)
  }

  const handleDropOnServer = (targetId: string) => {
    if (!draggedServerId || draggedServerId === targetId) {
      setDraggedServerId(null)
      return
    }
    // Si les deux sont libres → nouveau dossier
    const folderId = genFolderId()
    const color = FOLDER_COLORS[Math.floor(Math.random() * FOLDER_COLORS.length)]
    const next = { ...folders }
    // Retirer les 2 de tout dossier existant où ils pourraient être
    for (const [fid, f] of Object.entries(next)) {
      const ids = f.serverIds.filter(id => id !== draggedServerId && id !== targetId)
      if (ids.length === 0) delete next[fid]
      else next[fid] = { ...f, serverIds: ids }
    }
    next[folderId] = { name: 'Nouveau dossier', color, serverIds: [draggedServerId, targetId] }
    persistFolders(next)
    setExpandedFolders(prev => new Set([...prev, folderId]))
    setDraggedServerId(null)
  }

  const ServerIcon = ({ s, folderId: _folderId }: { s: any; folderId?: string }) => {
    const muted = isServerMuted(s.id)
    const isActive = serverId === s.id
    const hasUnread = (serverCounts[s.id] ?? 0) > 0 && !isActive && !muted
    return (
      <div className="relative w-full flex items-center justify-center">
        {/* Discord-style active pill indicator */}
        <span
          aria-hidden
          className={`absolute left-0 w-1 rounded-r-full bg-white transition-all duration-200 ${
            isActive ? 'h-9' : hasUnread ? 'h-2.5' : 'h-0 opacity-0'
          }`}
        />
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
          draggable
          onDragStart={() => handleDragStart(s.id)}
          onDragOver={e => e.preventDefault()}
          onDrop={() => handleDropOnServer(s.id)}
          aria-current={isActive ? 'page' : undefined}
          aria-label={s.name}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all hover:rounded-2xl font-bold text-white select-none
            ${isActive ? 'bg-fc-accent rounded-2xl' : 'bg-fc-channel hover:bg-fc-accent'}
            ${draggedServerId === s.id ? 'opacity-50' : ''}`}
          title={s.name}
        >
          {s.icon
            ? <img src={mediaUrl(s.icon)} alt={s.name} loading="lazy" decoding="async" className="w-full h-full rounded-full object-cover" />
            : s.name.charAt(0).toUpperCase()}
        </button>
        {/* Non-lu = pilule blanche à gauche (ci-dessus) ; mentions = pastille rouge chiffrée */}
        {(serverMentionCounts[s.id] ?? 0) > 0 && (
          <span
            role="status"
            aria-label={`${serverMentionCounts[s.id]} mention${serverMentionCounts[s.id] > 1 ? 's' : ''} non lue${serverMentionCounts[s.id] > 1 ? 's' : ''} sur ${s.name}`}
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
    <div className="fc-server-rail flex flex-col items-center py-3 w-[72px] bg-fc-bg gap-2 overflow-y-auto overscroll-y-contain relative">
      {/* DMs */}
      <div className="relative w-full flex items-center justify-center">
        <span aria-hidden className={`absolute left-0 w-1 h-9 rounded-r-full bg-white transition-all duration-200 ${isDMs ? 'opacity-100' : 'opacity-0 h-0'}`} />
        <button
          onClick={() => { nav('/friends'); closeSidebar() }}
          aria-current={isDMs ? 'page' : undefined}
          aria-label={t('servers.dms')}
          className={`min-w-[44px] min-h-[44px] w-12 h-12 rounded-full flex items-center justify-center transition-all hover:rounded-2xl ${isDMs ? 'bg-fc-accent rounded-2xl' : 'bg-fc-channel hover:bg-fc-accent'}`}
          title={t('servers.dms')}
        >
          <MessageCircle size={20} className="text-fc-text" />
        </button>
        {dmUnread > 0 && (
          <span
            role="status"
            aria-label={t(dmUnread > 1 ? 'servers.dmUnread.other' : 'servers.dmUnread.one', { n: dmUnread > 99 ? '99+' : dmUnread })}
            className="absolute bottom-0 right-2 min-w-[16px] h-4 px-1 bg-fc-red text-white text-[9px] font-bold rounded-full border-2 border-fc-bg flex items-center justify-center"
          >
            <span aria-hidden>{dmUnread > 99 ? '99+' : dmUnread}</span>
          </span>
        )}
      </div>

      {/* Messages sauvegardés */}
      <div className="relative w-full flex items-center justify-center">
        <span aria-hidden className={`absolute left-0 w-1 h-9 rounded-r-full bg-white transition-all duration-200 ${isSaved ? 'opacity-100' : 'opacity-0 h-0'}`} />
        <button
          onClick={() => { nav('/saved'); closeSidebar() }}
          aria-current={isSaved ? 'page' : undefined}
          aria-label={t('servers.saved')}
          className={`min-w-[44px] min-h-[44px] w-12 h-12 rounded-full flex items-center justify-center transition-all hover:rounded-2xl ${isSaved ? 'bg-fc-accent rounded-2xl' : 'bg-fc-channel hover:bg-fc-accent'}`}
          title={t('servers.saved')}
        >
          <Bookmark size={20} className="text-fc-text" />
        </button>
      </div>

      <div className="w-8 h-px bg-fc-hover mx-auto" />

      {/* Serveurs libres (ordonnés, avec slots de réordonnement) */}
      {/* Slot avant le premier serveur */}
      {orderedFreeServers.length > 0 && (
        <div
          className={`w-8 h-1 rounded-full mx-auto transition-all ${dragOverSlot === 0 ? 'bg-fc-accent h-1.5' : 'bg-transparent'}`}
          onDragOver={e => handleSlotDragOver(e, 0)}
          onDrop={e => handleSlotDrop(e, 0)}
          onDragLeave={handleSlotDragLeave}
        />
      )}
      {orderedFreeServers.map((s: any, idx: number) => (
        <div key={s.id} className="flex flex-col items-center gap-0 w-full">
          <ServerIcon s={s} />
          {/* Slot après chaque serveur */}
          <div
            className={`w-8 h-1 rounded-full mx-auto mt-0.5 transition-all ${dragOverSlot === idx + 1 ? 'bg-fc-accent h-1.5' : 'bg-transparent'}`}
            onDragOver={e => handleSlotDragOver(e, idx + 1)}
            onDrop={e => handleSlotDrop(e, idx + 1)}
            onDragLeave={handleSlotDragLeave}
          />
        </div>
      ))}

      {/* Dossiers */}
      {Object.entries(folders).map(([folderId, folder]) => {
        const folderServers = folder.serverIds
          .map(id => (servers as any[]).find((s: any) => s.id === id))
          .filter(Boolean)
        if (folderServers.length === 0) return null
        const isExpanded = expandedFolders.has(folderId)
        const hasActiveServer = folderServers.some((s: any) => s.id === serverId)

        return (
          <div key={folderId} className="flex flex-col items-center gap-1">
            {/* Icône dossier */}
            <button
              onClick={() => toggleFolder(folderId)}
              className={`w-12 h-12 rounded-2xl flex flex-col items-center justify-center transition-all gap-0.5
                ${hasActiveServer ? 'ring-2 ring-fc-accent' : ''}
                hover:brightness-110`}
              style={{ backgroundColor: folder.color + '33', border: `2px solid ${folder.color}` }}
              title={folder.name}
            >
              <FolderOpen size={14} style={{ color: folder.color }} />
              <span className="text-[9px] font-bold" style={{ color: folder.color }}>
                {folderServers.length}
              </span>
              <ChevronDown
                size={10}
                style={{ color: folder.color }}
                className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              />
            </button>

            {/* Serveurs du dossier (expand) */}
            {isExpanded && (
              <div className="flex flex-col items-center gap-1 pl-0">
                {folderServers.map((s: any) => (
                  <div key={s.id} className="relative group">
                    <ServerIcon s={s} folderId={folderId} />
                    {/* Bouton retirer du dossier (au hover) */}
                    <button
                      onClick={e => { e.stopPropagation(); removeFromFolder(s.id, folderId) }}
                      className="absolute -top-1 -right-1 w-4 h-4 bg-fc-red rounded-full items-center justify-center hidden group-hover:flex"
                      title={t('servers.removeFromFolder')}
                    >
                      <X size={8} className="text-white" />
                    </button>
                  </div>
                ))}
              </div>
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
