import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Search, Hash, User, Settings, MessageCircle, Plus,
  Compass, Clock, ChevronRight, X,
} from 'lucide-react'
import api from '../api/client'
import { useKeyboardNav } from '../hooks/useKeyboardNav'

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
}

interface PaletteItem {
  id: string
  category: string
  label: string
  sublabel?: string
  icon: React.ReactNode
  action: () => void
}

interface SearchResult {
  channels: Array<{ id: string; name: string; server_id: string; server_name: string }>
  users: Array<{ id: string; username: string; status: string }>
  messages: Array<{
    id: string; content: string; channel_id: string
    server_id: string; author_username: string
  }>
}

interface RecentChannel {
  id: string; name: string; serverId: string; serverName: string
}

const RECENT_KEY = 'fc_recent_channels'
const MAX_RECENT = 5

export function pushRecentChannel(channel: RecentChannel) {
  try {
    const stored: RecentChannel[] = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    const filtered = stored.filter(c => c.id !== channel.id)
    localStorage.setItem(RECENT_KEY, JSON.stringify([channel, ...filtered].slice(0, MAX_RECENT)))
  } catch { /* localStorage indisponible */ }
}

function getRecentChannels(): RecentChannel[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') } catch { return [] }
}

const STATUS_COLOR: Record<string, string> = {
  online: 'bg-green-500', idle: 'bg-yellow-500', dnd: 'bg-red-500', offline: 'bg-fc-muted',
}

export default function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const nav = useNavigate()

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 200)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    if (isOpen) {
      setQuery(''); setDebouncedQuery('')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  const { data: searchResults } = useQuery<SearchResult>({
    queryKey: ['cmd_search', debouncedQuery],
    queryFn: () => api.get(`/search?q=${encodeURIComponent(debouncedQuery)}`).then(r => r.data),
    enabled: debouncedQuery.trim().length >= 2,
    staleTime: 10_000,
  })

  const navigate = useCallback((path: string) => { nav(path); onClose() }, [nav, onClose])

  const items: PaletteItem[] = []

  if (!debouncedQuery) {
    for (const ch of getRecentChannels()) {
      items.push({
        id: `recent-${ch.id}`, category: 'Canaux récents',
        label: `#${ch.name}`, sublabel: ch.serverName,
        icon: <Clock size={14} className="text-fc-muted" />,
        action: () => navigate(`/servers/${ch.serverId}/channels/${ch.id}`),
      })
    }
  }

  if (debouncedQuery.trim().length >= 2 && searchResults) {
    for (const ch of searchResults.channels ?? []) {
      items.push({
        id: `ch-${ch.id}`, category: 'Canaux', label: `#${ch.name}`, sublabel: ch.server_name,
        icon: <Hash size={14} className="text-fc-muted" />,
        action: () => navigate(`/servers/${ch.server_id}/channels/${ch.id}`),
      })
    }
    for (const u of searchResults.users ?? []) {
      items.push({
        id: `user-${u.id}`, category: 'Membres', label: `@${u.username}`,
        sublabel: u.status === 'online' ? 'En ligne' : 'Hors ligne',
        icon: (
          <div className="relative">
            <User size={14} className="text-fc-muted" />
            <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-fc-channel ${STATUS_COLOR[u.status] ?? 'bg-fc-muted'}`} />
          </div>
        ),
        action: () => navigate(`/users/${u.id}`),
      })
    }
    for (const msg of (searchResults.messages ?? []).slice(0, 3)) {
      const preview = msg.content.length > 60 ? `${msg.content.slice(0, 60)}…` : msg.content
      items.push({
        id: `msg-${msg.id}`, category: 'Messages', label: preview, sublabel: `par @${msg.author_username}`,
        icon: <MessageCircle size={14} className="text-fc-muted" />,
        action: () => navigate(`/servers/${msg.server_id}/channels/${msg.channel_id}`),
      })
    }
  }

  const quickActions: PaletteItem[] = [
    { id: 'action-settings', category: 'Actions', label: 'Paramètres', icon: <Settings size={14} className="text-fc-muted" />, action: () => navigate('/settings') },
    { id: 'action-dm', category: 'Actions', label: 'Nouveau message direct', icon: <MessageCircle size={14} className="text-fc-muted" />, action: () => navigate('/friends') },
    { id: 'action-explore', category: 'Actions', label: 'Découvrir des serveurs', icon: <Compass size={14} className="text-fc-muted" />, action: () => navigate('/discovery') },
    { id: 'action-create', category: 'Actions', label: 'Créer un serveur', icon: <Plus size={14} className="text-fc-muted" />, action: () => navigate('/explore') },
  ].filter(a => !debouncedQuery || a.label.toLowerCase().includes(debouncedQuery.toLowerCase()))

  const allItems = [...items, ...quickActions]

  const { activeIndex: selected, setActiveIndex: setSelected, handleKey: navKey } = useKeyboardNav(
    allItems,
    (item) => item.action(),
    isOpen,
  )

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selected}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return }
    navKey(e.nativeEvent)
  }

  if (!isOpen) return null

  const groups: Record<string, PaletteItem[]> = {}
  for (const item of allItems) {
    if (!groups[item.category]) groups[item.category] = []
    groups[item.category].push(item)
  }

  let flatIdx = 0

  return (
    <div className="fixed inset-0 bg-black/60 z-[100] flex items-start justify-center pt-24" onClick={onClose}>
      <div className="w-full max-w-lg bg-fc-channel border border-fc-hover rounded-xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-fc-hover">
          <Search size={18} className="text-fc-muted flex-shrink-0" />
          <input
            ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey} placeholder="Rechercher ou saisir une commande..."
            className="flex-1 bg-transparent text-white placeholder-fc-muted outline-none text-sm"
          />
          {query && (
            <button onClick={() => setQuery('')} className="p-0.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition">
              <X size={14} />
            </button>
          )}
          <kbd className="text-xs text-fc-muted bg-fc-hover px-1.5 py-0.5 rounded">Échap</kbd>
        </div>

        <div ref={listRef} className="max-h-96 overflow-y-auto py-2">
          {allItems.length === 0 && <div className="px-4 py-8 text-center text-fc-muted text-sm">Aucun résultat</div>}
          {Object.entries(groups).map(([category, groupItems]) => (
            <div key={category}>
              <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-fc-muted">{category}</div>
              {groupItems.map(item => {
                const idx = flatIdx++
                return (
                  <button
                    key={item.id} data-idx={idx} onClick={item.action}
                    onMouseEnter={() => setSelected(idx)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition
                      ${idx === selected ? 'bg-fc-accent/20 text-white' : 'text-fc-text hover:bg-fc-hover'}`}
                  >
                    <div className="flex-shrink-0 w-5 flex items-center justify-center">{item.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{item.label}</div>
                      {item.sublabel && <div className="text-xs text-fc-muted truncate">{item.sublabel}</div>}
                    </div>
                    <ChevronRight size={14} className="text-fc-muted flex-shrink-0 opacity-60" />
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <div className="px-4 py-2 border-t border-fc-hover flex items-center gap-4 text-xs text-fc-muted">
          <span><kbd className="bg-fc-hover px-1 rounded">↑↓</kbd> naviguer</span>
          <span><kbd className="bg-fc-hover px-1 rounded">Entrée</kbd> ouvrir</span>
          <span><kbd className="bg-fc-hover px-1 rounded">Échap</kbd> fermer</span>
        </div>
      </div>
    </div>
  )
}
