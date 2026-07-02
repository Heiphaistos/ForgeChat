import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bookmark, Trash2, ArrowRight, Image, Link2, FileText, File, ChevronLeft } from 'lucide-react'
import { useMobile } from '../contexts/MobileContext'
import { isToday, isThisWeek, isThisMonth } from 'date-fns'
import { fr } from 'date-fns/locale'
import api from '../api/client'
import { useFormatDate } from '../hooks/useFormatDate'
import toast from 'react-hot-toast'

interface SavedMessage {
  id: string
  message_id: string
  channel_id: string
  server_id: string
  server_name?: string
  channel_name?: string
  content: string
  author_username: string
  author_avatar?: string
  attachments?: Attachment[]
  created_at: string
  saved_at: string
}

interface Attachment {
  url: string
  filename: string
  content_type?: string
  size?: number
}

type FilterType = 'all' | 'text' | 'image' | 'link' | 'file'
type SortType = 'newest' | 'oldest'

// ── Helpers ────────────────────────────────────────────────────────────────

const URL_REGEX = /https?:\/\/[^\s]+/

function detectType(item: SavedMessage): FilterType {
  const hasImage = item.attachments?.some(a =>
    a.content_type?.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(a.filename)
  )
  if (hasImage) return 'image'

  const hasFile = item.attachments && item.attachments.length > 0
  if (hasFile) return 'file'

  const hasLink = URL_REGEX.test(item.content)
  if (hasLink) return 'link'

  return 'text'
}

function getDateGroup(dateStr: string): string {
  const d = new Date(dateStr)
  if (isToday(d)) return "Aujourd'hui"
  if (isThisWeek(d, { locale: fr })) return 'Cette semaine'
  if (isThisMonth(d)) return 'Ce mois'
  return 'Plus ancien'
}

const DATE_GROUP_ORDER = ["Aujourd'hui", 'Cette semaine', 'Ce mois', 'Plus ancien']

function formatFileSize(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

// ── Tab button ─────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ElementType
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition ${
        active
          ? 'bg-fc-accent text-white'
          : 'text-fc-muted hover:text-white hover:bg-fc-hover'
      }`}
    >
      <Icon size={14} />
      {label}
    </button>
  )
}

// ── Attachment preview ─────────────────────────────────────────────────────

function AttachmentPreview({ attachment }: { attachment: Attachment }) {
  const isImage =
    attachment.content_type?.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(attachment.filename)

  if (isImage) {
    return (
      <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="block">
        <img
          src={attachment.url}
          alt={attachment.filename}
          className="max-h-32 max-w-xs rounded-lg object-cover border border-fc-hover hover:opacity-90 transition"
        />
      </a>
    )
  }

  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 bg-fc-bg border border-fc-hover rounded-lg px-3 py-2 text-sm hover:border-fc-accent transition"
    >
      <File size={16} className="text-fc-muted flex-shrink-0" />
      <span className="text-fc-text truncate max-w-[180px]">{attachment.filename}</span>
      {attachment.size && (
        <span className="text-fc-muted text-xs flex-shrink-0">{formatFileSize(attachment.size)}</span>
      )}
    </a>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function SavedPage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const { openSidebar } = useMobile()
  const { formatTs } = useFormatDate()
  const [filter, setFilter] = useState<FilterType>('all')
  const [sort, setSort] = useState<SortType>('newest')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const { data: saved = [], isLoading } = useQuery<SavedMessage[]>({
    queryKey: ['saved_messages'],
    queryFn: () => api.get('/saved').then(r => r.data),
  })

  const remove = useMutation({
    mutationFn: (messageId: string) => api.delete(`/saved/${messageId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['saved_messages'] })
      toast.success('Message retiré des sauvegardés')
    },
    onError: () => toast.error('Erreur lors de la suppression'),
  })

  const goToMessage = (item: SavedMessage) => {
    if (item.server_id) {
      nav(`/servers/${item.server_id}/channels/${item.channel_id}?highlight=${item.message_id}`)
    } else {
      nav(`/dms/${item.channel_id}?highlight=${item.message_id}`)
    }
  }

  const toggleExpanded = (id: string) =>
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))

  // Filtered + sorted list
  const processed = useMemo(() => {
    let list = filter === 'all' ? saved : saved.filter(m => detectType(m) === filter)
    list = [...list].sort((a, b) => {
      const diff = new Date(a.saved_at).getTime() - new Date(b.saved_at).getTime()
      return sort === 'newest' ? -diff : diff
    })
    return list
  }, [saved, filter, sort])

  // Grouped by date
  const grouped = useMemo(() => {
    const map: Record<string, SavedMessage[]> = {}
    for (const item of processed) {
      const group = getDateGroup(item.saved_at)
      if (!map[group]) map[group] = []
      map[group].push(item)
    }
    return map
  }, [processed])

  const activeGroups = DATE_GROUP_ORDER.filter(g => grouped[g]?.length)

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-fc-bg">
      {/* ── Header ── */}
      <div className="px-4 py-4 border-b border-fc-hover flex items-center gap-3">
        <button
          className="md:hidden flex items-center justify-center p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition flex-shrink-0"
          onClick={openSidebar}
          aria-label="Retour"
        >
          <ChevronLeft size={20} />
        </button>
        <Bookmark size={20} className="text-fc-accent" />
        <h1 className="text-lg font-bold text-white">Messages sauvegardés</h1>
        {saved.length > 0 && (
          <span className="text-xs text-fc-muted bg-fc-hover px-2 py-0.5 rounded-full">{saved.length}</span>
        )}
      </div>

      {/* ── Filter bar ── */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-fc-hover flex-wrap">
        <TabButton active={filter === 'all'} onClick={() => setFilter('all')} icon={Bookmark} label="Tout" />
        <TabButton active={filter === 'text'} onClick={() => setFilter('text')} icon={FileText} label="Messages" />
        <TabButton active={filter === 'image'} onClick={() => setFilter('image')} icon={Image} label="Images" />
        <TabButton active={filter === 'link'} onClick={() => setFilter('link')} icon={Link2} label="Liens" />
        <TabButton active={filter === 'file'} onClick={() => setFilter('file')} icon={File} label="Fichiers" />
        <div className="ml-auto">
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortType)}
            className="bg-fc-channel text-sm text-white px-2 py-1.5 rounded border border-fc-hover focus:outline-none focus:border-fc-accent cursor-pointer"
          >
            <option value="newest">Plus récent</option>
            <option value="oldest">Plus ancien</option>
          </select>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-fc-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : processed.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <Bookmark size={48} className="text-fc-muted opacity-40" />
            <p className="text-fc-muted text-sm">
              {filter === 'all' ? 'Aucun message sauvegardé' : `Aucun message de type "${filter}"`}
            </p>
            {filter === 'all' && (
              <p className="text-fc-muted/60 text-xs max-w-xs">
                Survole un message et clique sur l'icône Bookmark pour le sauvegarder.
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-6 max-w-2xl">
            {activeGroups.map(group => (
              <div key={group}>
                {/* Sticky date separator */}
                <div className="sticky top-0 z-10 flex items-center gap-3 py-2 mb-3 bg-fc-bg">
                  <span className="text-xs font-semibold text-fc-muted uppercase tracking-wide">{group}</span>
                  <div className="flex-1 h-px bg-fc-hover" />
                  <span className="text-xs text-fc-muted">{grouped[group].length}</span>
                </div>

                <div className="flex flex-col gap-3">
                  {grouped[group].map(item => {
                    const isExp = expanded[item.id]
                    const content = item.content ?? ''
                    const isLong = content.length > 200
                    const displayContent = isLong && !isExp ? content.slice(0, 200) + '…' : content

                    return (
                      <div
                        key={item.id}
                        className="bg-fc-channel rounded-lg p-4 group hover:bg-fc-hover/30 transition border border-fc-hover/50"
                      >
                        {/* Breadcrumb */}
                        {(item.server_name || item.channel_name) && (
                          <div className="flex items-center gap-1 text-xs text-fc-muted mb-2">
                            <span className="text-fc-muted/60">🔒</span>
                            {item.server_name && (
                              <span className="font-medium text-fc-muted">{item.server_name}</span>
                            )}
                            {item.server_name && item.channel_name && (
                              <span className="text-fc-muted/40 mx-0.5">›</span>
                            )}
                            {item.channel_name && (
                              <span className="text-fc-accent/80">#{item.channel_name}</span>
                            )}
                          </div>
                        )}

                        <div className="flex items-start gap-3">
                          {/* Avatar */}
                          <div className="w-9 h-9 rounded-full bg-fc-accent flex items-center justify-center text-sm font-bold text-white flex-shrink-0 overflow-hidden">
                            {item.author_avatar
                              ? <img src={item.author_avatar} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                              : item.author_username.charAt(0).toUpperCase()}
                          </div>

                          <div className="flex-1 min-w-0">
                            {/* Author + date */}
                            <div className="flex items-baseline gap-2 mb-1">
                              <span className="text-sm font-semibold text-white">{item.author_username}</span>
                              <span className="text-xs text-fc-muted">
                                {formatTs(item.created_at)}
                              </span>
                            </div>

                            {/* Content */}
                            {content && (
                              <div className="text-sm text-fc-text break-words leading-relaxed">
                                <span>{displayContent}</span>
                                {isLong && (
                                  <button
                                    onClick={() => toggleExpanded(item.id)}
                                    className="ml-1 text-fc-accent hover:underline text-xs"
                                  >
                                    {isExp ? 'Réduire' : 'Voir plus'}
                                  </button>
                                )}
                              </div>
                            )}

                            {/* Attachments */}
                            {item.attachments && item.attachments.length > 0 && (
                              <div className="flex flex-wrap gap-2 mt-2">
                                {item.attachments.map((att, i) => (
                                  <AttachmentPreview key={i} attachment={att} />
                                ))}
                              </div>
                            )}

                            {/* Saved date */}
                            <p className="text-xs text-fc-muted/60 mt-2">
                              Sauvegardé le {formatTs(item.saved_at)}
                            </p>
                          </div>

                          {/* Actions (hover) */}
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition flex-shrink-0">
                            <button
                              onClick={() => goToMessage(item)}
                              className="p-1.5 text-fc-muted hover:text-fc-accent rounded hover:bg-fc-hover transition"
                              title="Aller au message"
                            >
                              <ArrowRight size={14} />
                            </button>
                            <button
                              onClick={() => remove.mutate(item.message_id)}
                              className="p-1.5 text-fc-muted hover:text-red-400 rounded hover:bg-fc-hover transition"
                              title="Retirer"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
