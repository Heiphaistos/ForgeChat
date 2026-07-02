import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bookmark, MessageCircle, Plus, Compass, ChevronDown, FolderOpen, X, LayoutTemplate, Settings, LogOut, Copy, BellOff, Bell } from 'lucide-react'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import api from '../../api/client'
import toast from 'react-hot-toast'
import ServerTemplateModal from '../modals/ServerTemplateModal'
import { useAuth } from '../../store/auth'
import { useUnread } from '../../store/unread'
import { useChannelNotif } from '../../store/channelNotif'

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

// ─── Built-in Templates ─────────────────────────────────────

const BUILTIN_TEMPLATES = [
  {
    id: '__gaming__',
    name: 'Gaming',
    description: 'Serveur pour jouer ensemble',
    template_data: {
      categories: [{ id: '__cat1__', name: 'Texte', position: 0 }, { id: '__cat2__', name: 'Vocal', position: 1 }],
      channels: [
        { id: '__c1__', name: 'général', type: 'text', position: 0, category_id: '__cat1__' },
        { id: '__c2__', name: 'stratégie', type: 'text', position: 1, category_id: '__cat1__' },
        { id: '__c3__', name: 'recrutement', type: 'text', position: 2, category_id: '__cat1__' },
        { id: '__c4__', name: 'Gaming', type: 'voice', position: 0, category_id: '__cat2__' },
        { id: '__c5__', name: 'AFK', type: 'voice', position: 1, category_id: '__cat2__' },
      ],
      roles: [],
    },
  },
  {
    id: '__community__',
    name: 'Communauté',
    description: 'Serveur communautaire ouvert',
    template_data: {
      categories: [{ id: '__cat1__', name: 'Info', position: 0 }, { id: '__cat2__', name: 'Discussion', position: 1 }],
      channels: [
        { id: '__c1__', name: 'accueil', type: 'text', position: 0, category_id: '__cat1__' },
        { id: '__c2__', name: 'règles', type: 'text', position: 1, category_id: '__cat1__' },
        { id: '__c3__', name: 'général', type: 'text', position: 0, category_id: '__cat2__' },
        { id: '__c4__', name: 'événements', type: 'text', position: 1, category_id: '__cat2__' },
        { id: '__c5__', name: 'Salon principal', type: 'voice', position: 0, category_id: null },
      ],
      roles: [],
    },
  },
  {
    id: '__study__',
    name: 'Étude',
    description: 'Groupe de révision et d\'entraide',
    template_data: {
      categories: [{ id: '__cat1__', name: 'Texte', position: 0 }, { id: '__cat2__', name: 'Vocal', position: 1 }],
      channels: [
        { id: '__c1__', name: 'général', type: 'text', position: 0, category_id: '__cat1__' },
        { id: '__c2__', name: 'ressources', type: 'text', position: 1, category_id: '__cat1__' },
        { id: '__c3__', name: 'entraide', type: 'text', position: 2, category_id: '__cat1__' },
        { id: '__c4__', name: 'Révisions ensemble', type: 'voice', position: 0, category_id: '__cat2__' },
      ],
      roles: [],
    },
  },
  {
    id: '__team__',
    name: 'Team',
    description: 'Espace de travail collaboratif',
    template_data: {
      categories: [{ id: '__cat1__', name: 'Général', position: 0 }, { id: '__cat2__', name: 'Vocal', position: 1 }],
      channels: [
        { id: '__c1__', name: 'annonces', type: 'announcement', position: 0, category_id: '__cat1__' },
        { id: '__c2__', name: 'général', type: 'text', position: 1, category_id: '__cat1__' },
        { id: '__c3__', name: 'tâches', type: 'text', position: 2, category_id: '__cat1__' },
        { id: '__c4__', name: 'Standup', type: 'voice', position: 0, category_id: '__cat2__' },
      ],
      roles: [],
    },
  },
]

// ─── ServerSidebar ──────────────────────────────────────────

export default function ServerSidebar() {
  const { serverId } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const serverCounts = useUnread(s => s.serverCounts)
  const [showCreate, setShowCreate] = useState(false)
  const [showTemplateModal, setShowTemplateModal] = useState(false)
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

  const me = useAuth(s => s.user)
  const isServerMuted = useChannelNotif(s => s.isServerMuted)
  const setServerMuted = useChannelNotif(s => s.setServerMuted)

  const { data: servers = [] } = useQuery({
    queryKey: ['servers'],
    queryFn: () => api.get('/servers').then(r => r.data),
  })

  const createServer = useMutation({
    mutationFn: (payload: { name: string; template_data?: any }) => {
      if (payload.template_data) {
        return api.post('/servers', { name: payload.name }).then(async res => {
          const newServerId = res.data.id
          const tdata = payload.template_data
          const catMap: Record<string, string> = {}
          for (const cat of (tdata.categories ?? [])) {
            try {
              const cr = await api.post(`/servers/${newServerId}/categories`, { name: cat.name, position: cat.position })
              catMap[cat.id] = cr.data.id
            } catch { /* ignore */ }
          }
          for (const ch of (tdata.channels ?? [])) {
            const newCatId = ch.category_id ? catMap[ch.category_id] : undefined
            try {
              await api.post(`/servers/${newServerId}/channels`, {
                name: ch.name,
                type: ch.type,
                position: ch.position,
                category_id: newCatId ?? null,
              })
            } catch { /* ignore */ }
          }
          return res
        })
      }
      return api.post('/servers', { name: payload.name })
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['servers'] })
      nav(`/servers/${res.data.id}`)
      setShowCreate(false)
      toast.success('Serveur créé !')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
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
  const serverIdsInFolders = new Set(
    Object.values(folders).flatMap(f => f.serverIds)
  )

  // Séquence : serveurs libres + dossiers (en ordre d'insertion)
  const freeServers = (servers as any[]).filter(s => !serverIdsInFolders.has(s.id))

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
    const hasUnread = (serverCounts[s.id] ?? 0) > 0 && serverId !== s.id && !muted
    return (
      <div className="relative">
        <button
          key={s.id}
          onClick={() => nav(`/servers/${s.id}`)}
          onContextMenu={e => handleContextMenu(e, s.id)}
          draggable
          onDragStart={() => handleDragStart(s.id)}
          onDragOver={e => e.preventDefault()}
          onDrop={() => handleDropOnServer(s.id)}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all hover:rounded-2xl font-bold text-white select-none
            ${serverId === s.id ? 'bg-fc-accent rounded-2xl' : 'bg-fc-channel hover:bg-fc-accent'}
            ${draggedServerId === s.id ? 'opacity-50' : ''}`}
          title={s.name}
        >
          {s.icon
            ? <img src={s.icon} alt={s.name} loading="lazy" decoding="async" className="w-full h-full rounded-full object-cover" />
            : s.name.charAt(0).toUpperCase()}
        </button>
        {hasUnread && (
          <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-fc-red rounded-full border-2 border-fc-bg" />
        )}
        {muted && (
          <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-fc-muted/80 rounded-full border-2 border-fc-bg flex items-center justify-center">
            <BellOff size={7} className="text-white" />
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center py-3 w-[72px] bg-fc-bg gap-2 overflow-y-auto overscroll-y-contain relative">
      {/* DMs */}
      <button
        onClick={() => nav('/friends')}
        className="w-12 h-12 bg-fc-channel hover:bg-fc-accent rounded-full flex items-center justify-center transition-all hover:rounded-2xl"
        title="Messages directs"
      >
        <MessageCircle size={20} className="text-fc-text" />
      </button>

      {/* Messages sauvegardés */}
      <button
        onClick={() => nav('/saved')}
        className="w-12 h-12 bg-fc-channel hover:bg-fc-accent rounded-full flex items-center justify-center transition-all hover:rounded-2xl"
        title="Messages sauvegardés"
      >
        <Bookmark size={20} className="text-fc-text" />
      </button>

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
        <div key={s.id} className="flex flex-col items-center gap-0">
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
                      title="Retirer du dossier"
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

      {/* Explorer */}
      <button
        onClick={() => nav('/explore')}
        className="w-12 h-12 bg-fc-channel hover:bg-fc-accent rounded-full flex items-center justify-center transition-all hover:rounded-2xl text-fc-muted hover:text-white"
        title="Explorer les serveurs"
      >
        <Compass size={20} />
      </button>

      {/* Créer serveur */}
      <button
        onClick={() => setShowCreate(true)}
        className="w-12 h-12 bg-fc-channel hover:bg-fc-green rounded-full flex items-center justify-center transition-all hover:rounded-2xl text-fc-green hover:text-white"
        title="Créer un serveur"
      >
        <Plus size={24} />
      </button>

      {/* Utiliser un template */}
      <button
        onClick={() => setShowTemplateModal(true)}
        className="w-12 h-12 bg-fc-channel hover:bg-fc-accent rounded-full flex items-center justify-center transition-all hover:rounded-2xl text-fc-muted hover:text-white"
        title="Utiliser un template"
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
            style={{ top: contextMenu.y, left: contextMenu.x }}
          >
            {/* Actions serveur */}
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-fc-text hover:bg-fc-hover hover:text-white transition flex items-center gap-2"
              onClick={() => { nav(`/servers/${contextMenu.serverId}/settings`); setContextMenu(null) }}
            >
              <Settings size={12} /> Paramètres du serveur
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-fc-text hover:bg-fc-hover hover:text-white transition flex items-center gap-2"
              onClick={() => { navigator.clipboard.writeText(contextMenu.serverId); toast.success('ID copié'); setContextMenu(null) }}
            >
              <Copy size={12} /> Copier l'ID
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-fc-text hover:bg-fc-hover hover:text-white transition flex items-center gap-2"
              onClick={async () => {
                const muted = isServerMuted(contextMenu.serverId)
                try {
                  await api.post('/user/notification-overrides', {
                    server_id: contextMenu.serverId,
                    level: 'all',
                    muted: !muted,
                  })
                  setServerMuted(contextMenu.serverId, !muted)
                  toast.success(muted ? 'Notifications réactivées' : 'Serveur mis en sourdine')
                } catch {
                  toast.error('Impossible de modifier les notifications')
                }
                setContextMenu(null)
              }}
            >
              {isServerMuted(contextMenu.serverId)
                ? <><Bell size={12} /> Réactiver les notifications</>
                : <><BellOff size={12} /> Mettre en sourdine</>
              }
            </button>

            {/* Dossiers */}
            <div className="my-1 border-t border-fc-hover" />
            <div className="px-3 py-1 text-xs text-fc-muted font-semibold uppercase tracking-wide">
              Dossiers
            </div>
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-fc-text hover:bg-fc-hover hover:text-white transition flex items-center gap-2"
              onClick={() => addToNewFolder(contextMenu.serverId)}
            >
              <Plus size={12} /> Nouveau dossier
            </button>
            {Object.entries(folders).map(([fid, f]) => (
              <button
                key={fid}
                className="w-full text-left px-3 py-1.5 text-sm text-fc-text hover:bg-fc-hover hover:text-white transition flex items-center gap-2"
                onClick={() => addToExistingFolder(contextMenu.serverId, fid)}
              >
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: f.color }} />
                Ajouter dans {f.name}
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
                <X size={12} /> Retirer du dossier
              </button>
            )}

            {/* Quitter */}
            {!isOwner && (
              <>
                <div className="my-1 border-t border-fc-hover" />
                <button
                  className="w-full text-left px-3 py-1.5 text-sm text-fc-red hover:bg-fc-red/10 transition flex items-center gap-2"
                  onClick={async () => {
                    if (confirm(`Quitter le serveur "${ctxServer?.name}" ?`)) {
                      try {
                        await api.post(`/servers/${contextMenu.serverId}/leave`)
                        qc.invalidateQueries({ queryKey: ['servers'] })
                        nav('/friends')
                      } catch {
                        toast.error('Impossible de quitter le serveur')
                      }
                    }
                    setContextMenu(null)
                  }}
                >
                  <LogOut size={12} /> Quitter le serveur
                </button>
              </>
            )}
          </div>
        )
      })()}

      {showCreate && (
        <CreateServerModal
          onClose={() => setShowCreate(false)}
          onCreate={(name, templateData) => createServer.mutate({ name, template_data: templateData })}
          isPending={createServer.isPending}
        />
      )}

      {showTemplateModal && (
        <ServerTemplateModal onClose={() => setShowTemplateModal(false)} />
      )}
    </div>
  )
}

// ─── CreateServerModal avec templates ──────────────────────

type Step = 'choice' | 'template-grid' | 'name'

interface BuiltinTemplate {
  id: string
  name: string
  description: string
  template_data: any
}

function CreateServerModal({
  onClose,
  onCreate,
  isPending,
}: {
  onClose: () => void
  onCreate: (name: string, templateData?: any) => void
  isPending: boolean
}) {
  const [step, setStep] = useState<Step>('choice')
  const [name, setName] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<BuiltinTemplate | null>(null)

  // Templates côté serveur (DB)
  const { data: remoteTemplates } = useQuery<{ public: any[]; mine: any[] }>({
    queryKey: ['server-templates'],
    queryFn: () => api.get('/templates').then(r => r.data),
    enabled: step === 'template-grid',
  })

  const allPublicTemplates = [
    ...BUILTIN_TEMPLATES,
    ...(remoteTemplates?.public ?? []).map((t: any) => ({
      id: t.id,
      name: t.name,
      description: t.description ?? `Utilisé ${t.usage_count} fois`,
      template_data: t.template_data,
    })),
  ]

  const myRemoteTemplates = (remoteTemplates?.mine ?? []).map((t: any) => ({
    id: t.id,
    name: t.name,
    description: t.description ?? `Créé le ${new Date(t.created_at).toLocaleDateString('fr-FR')}`,
    template_data: t.template_data,
  }))

  const handleCreate = () => {
    if (!name.trim()) return
    onCreate(name.trim(), selectedTemplate?.template_data)
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className={`bg-fc-channel rounded-xl shadow-2xl overflow-hidden w-[calc(100vw-2rem)] ${step === 'template-grid' ? 'md:w-[560px]' : 'md:w-[400px]'}`}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Étape 1 : Choix ── */}
        {step === 'choice' && (
          <div className="p-6">
            <h2 className="text-xl font-bold text-white mb-1 text-center">Créer un serveur</h2>
            <p className="text-fc-muted text-sm mb-6 text-center">
              Commence depuis zéro ou utilise un template.
            </p>
            <div className="space-y-3">
              <button
                onClick={() => { setSelectedTemplate(null); setStep('name') }}
                className="w-full p-4 bg-fc-bg hover:bg-fc-hover rounded-lg text-left transition group"
              >
                <div className="font-semibold text-white group-hover:text-fc-accent transition">
                  Créer depuis zéro
                </div>
                <div className="text-xs text-fc-muted mt-0.5">
                  Serveur vide avec un canal général
                </div>
              </button>
              <button
                onClick={() => setStep('template-grid')}
                className="w-full p-4 bg-fc-bg hover:bg-fc-hover rounded-lg text-left transition group"
              >
                <div className="font-semibold text-white group-hover:text-fc-accent transition">
                  Depuis un template
                </div>
                <div className="text-xs text-fc-muted mt-0.5">
                  Gaming, Communauté, Étude, Team et plus...
                </div>
              </button>
            </div>
            <button onClick={onClose} className="mt-4 w-full py-2 text-fc-muted hover:text-white text-sm transition">
              Annuler
            </button>
          </div>
        )}

        {/* ── Étape 2 : Grille templates ── */}
        {step === 'template-grid' && (
          <div className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <button onClick={() => setStep('choice')} className="text-fc-muted hover:text-white transition">
                ←
              </button>
              <h2 className="text-lg font-bold text-white">Choisir un template</h2>
            </div>

            {/* Templates publics / built-in */}
            <div className="mb-4">
              <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">Templates publics</div>
              <div className="grid grid-cols-2 gap-2 max-h-[260px] overflow-y-auto pr-1">
                {allPublicTemplates.map(t => (
                  <button
                    key={t.id}
                    onClick={() => { setSelectedTemplate(t); setStep('name') }}
                    className="p-3 bg-fc-bg hover:bg-fc-hover rounded-lg text-left transition group border border-transparent hover:border-fc-accent/40"
                  >
                    <div className="font-medium text-white text-sm group-hover:text-fc-accent transition">{t.name}</div>
                    <div className="text-xs text-fc-muted mt-0.5 leading-snug line-clamp-2">{t.description}</div>
                    <div className="text-[10px] text-fc-muted/60 mt-1">
                      {t.template_data.channels?.length ?? 0} canaux
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Mes templates perso */}
            {myRemoteTemplates.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">Mes templates</div>
                <div className="grid grid-cols-2 gap-2 max-h-[160px] overflow-y-auto pr-1">
                  {myRemoteTemplates.map(t => (
                    <button
                      key={t.id}
                      onClick={() => { setSelectedTemplate(t); setStep('name') }}
                      className="p-3 bg-fc-bg hover:bg-fc-hover rounded-lg text-left transition group border border-transparent hover:border-fc-accent/40"
                    >
                      <div className="font-medium text-white text-sm group-hover:text-fc-accent transition">{t.name}</div>
                      <div className="text-xs text-fc-muted mt-0.5 line-clamp-2">{t.description}</div>
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
              <button onClick={() => setStep(selectedTemplate ? 'template-grid' : 'choice')} className="text-fc-muted hover:text-white transition">
                ←
              </button>
              <h2 className="text-xl font-bold text-white">
                {selectedTemplate ? `Template : ${selectedTemplate.name}` : 'Créer depuis zéro'}
              </h2>
            </div>
            {selectedTemplate && (
              <p className="text-xs text-fc-muted mb-3 ml-6">
                {selectedTemplate.template_data.channels?.length ?? 0} canaux seront créés
              </p>
            )}
            <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1 mt-3">
              Nom du serveur
            </label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Mon serveur"
              maxLength={100}
              className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent mb-4"
              onKeyDown={e => e.key === 'Enter' && name.trim() && handleCreate()}
            />
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 text-fc-muted hover:text-white transition">
                Annuler
              </button>
              <button
                onClick={handleCreate}
                disabled={!name.trim() || isPending}
                className="px-4 py-2 bg-fc-accent hover:bg-indigo-500 disabled:opacity-50 text-white rounded transition"
              >
                {isPending ? 'Création...' : 'Créer'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
