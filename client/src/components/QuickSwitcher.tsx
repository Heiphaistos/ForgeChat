import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, Hash, Volume2, Video, Megaphone, MessagesSquare, Radio, MessageCircle, ChevronRight } from 'lucide-react'
import api from '../api/client'
import { useKeyboardNav } from '../hooks/useKeyboardNav'

const HISTORY_KEY = 'fc_search_history'
function loadHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') } catch { return [] }
}
function saveToHistory(q: string) {
  if (!q.trim()) return
  const prev = loadHistory().filter(h => h !== q)
  localStorage.setItem(HISTORY_KEY, JSON.stringify([q, ...prev].slice(0, 5)))
}
function removeFromHistory(q: string) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(loadHistory().filter(h => h !== q)))
}
function clearHistory() {
  localStorage.removeItem(HISTORY_KEY)
}

interface Props {
  onClose: () => void
}

interface Result {
  type: 'channel' | 'dm'
  id: string
  name: string
  serverId?: string
  serverName?: string
  channelType?: string
}

function ChannelIcon({ type }: { type: string }) {
  switch (type) {
    case 'voice': return <Volume2 size={14} className="text-blue-400" />
    case 'video': return <Video size={14} className="text-purple-400" />
    case 'announcement': return <Megaphone size={14} className="text-yellow-400" />
    case 'forum': return <MessagesSquare size={14} className="text-green-400" />
    case 'stage': return <Radio size={14} className="text-red-400" />
    default: return <Hash size={14} className="text-fc-muted" />
  }
}

export default function QuickSwitcher({ onClose }: Props) {
  const [query, setQuery] = useState('')
  const [history, setHistory] = useState<string[]>(loadHistory)
  const [searchResults, setSearchResults] = useState<{
    messages: any[]
    users: any[]
    channels: any[]
  } | null>(null)
  const [searching, setSearching] = useState(false)
  const nav = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)

  const qc = useQueryClient()

  const { data: servers = [] } = useQuery({
    queryKey: ['servers'],
    queryFn: () => api.get('/servers').then(r => r.data),
  })

  const { data: dms = [] } = useQuery({
    queryKey: ['dms'],
    queryFn: () => api.get('/dms').then(r => r.data),
  })

  const results: Result[] = []

  for (const srv of servers) {
    // Use cached per-server data (includes channels) when available
    const cached = qc.getQueryData<any>(['server', srv.id])
    const channels: any[] = cached?.channels ?? srv.channels ?? []
    for (const ch of channels) {
      if (!query || ch.name.toLowerCase().includes(query.toLowerCase())) {
        results.push({
          type: 'channel',
          id: ch.id,
          name: ch.name,
          serverId: srv.id,
          serverName: srv.name,
          channelType: ch.type,
        })
      }
    }
  }

  for (const dm of dms) {
    if (!query || dm.username.toLowerCase().includes(query.toLowerCase())) {
      results.push({
        type: 'dm',
        id: dm.id,
        name: dm.username,
      })
    }
  }

  const filtered = results.slice(0, 10)

  const go = (r: Result) => {
    if (query.trim()) {
      saveToHistory(query.trim())
      setHistory(loadHistory())
    }
    if (r.type === 'channel') {
      nav(`/servers/${r.serverId}/channels/${r.id}`)
    } else {
      nav(`/dms/${r.id}`)
    }
    onClose()
  }

  const { activeIndex: selected, setActiveIndex: setSelected, handleKey: navKey } = useKeyboardNav(
    filtered,
    go,
    true,
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const q = query.startsWith('?') ? query.slice(1).trim() : null
    if (!q || q.length < 2) { setSearchResults(null); return }

    const controller = new AbortController()
    setSearching(true)
    api.get('/search', { params: { q }, signal: controller.signal })
      .then(r => { setSearchResults(r.data); setSearching(false) })
      .catch(() => setSearching(false))

    return () => controller.abort()
  }, [query])

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'Enter' && query.trim()) {
      saveToHistory(query.trim())
      setHistory(loadHistory())
    }
    navKey(e.nativeEvent)
  }

  if (query.startsWith('?')) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-16 md:pt-24 px-3 md:px-0" onClick={onClose}>
        <div className="bg-fc-sidebar border border-fc-hover rounded-xl w-full max-w-xl shadow-2xl" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-3 px-4 py-3 border-b border-fc-hover">
            <Search size={16} className="text-fc-muted flex-shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') onClose() }}
              placeholder="? Rechercher messages, utilisateurs, canaux..."
              className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-fc-muted"
              autoFocus
            />
            {searching && <div className="w-4 h-4 border-2 border-fc-accent border-t-transparent rounded-full animate-spin flex-shrink-0" />}
          </div>
          <div className="max-h-96 overflow-y-auto p-2 space-y-3">
            {searchResults ? (
              <>
                {searchResults.messages.length > 0 && (
                  <div>
                    <p className="text-[10px] text-fc-muted uppercase font-semibold tracking-wide px-2 mb-1">Messages</p>
                    {searchResults.messages.map((m: any) => (
                      <button key={m.id}
                        onClick={() => { nav(`/servers/${m.server_id}/channels/${m.channel_id}`); onClose() }}
                        className="w-full flex items-start gap-2 px-2 py-2 rounded hover:bg-fc-hover text-left transition">
                        <Hash size={13} className="text-fc-muted mt-0.5 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1 text-xs text-fc-muted">
                            <span className="font-medium text-white">{m.author_username}</span>
                            <span>dans #{m.channel_name}</span>
                          </div>
                          <p className="text-sm text-fc-text truncate">{m.content}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {searchResults.users.length > 0 && (
                  <div>
                    <p className="text-[10px] text-fc-muted uppercase font-semibold tracking-wide px-2 mb-1">Utilisateurs</p>
                    {searchResults.users.map((u: any) => (
                      <button key={u.id}
                        onClick={() => { nav(`/users/${u.id}`); onClose() }}
                        className="w-full flex items-center gap-2 px-2 py-2 rounded hover:bg-fc-hover transition">
                        <div className="w-7 h-7 rounded-full bg-fc-accent flex-shrink-0 flex items-center justify-center text-xs font-bold text-white overflow-hidden">
                          {u.avatar ? <img src={u.avatar} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" /> : u.username.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm text-white">{u.username}</span>
                      </button>
                    ))}
                  </div>
                )}
                {searchResults.channels.length > 0 && (
                  <div>
                    <p className="text-[10px] text-fc-muted uppercase font-semibold tracking-wide px-2 mb-1">Canaux</p>
                    {searchResults.channels.map((c: any) => (
                      <button key={c.id}
                        onClick={() => { nav(`/servers/${c.server_id}/channels/${c.id}`); onClose() }}
                        className="w-full flex items-center gap-2 px-2 py-2 rounded hover:bg-fc-hover transition">
                        <Hash size={13} className="text-fc-muted flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <span className="text-sm text-white">{c.name}</span>
                          <span className="text-xs text-fc-muted ml-1">• {c.server_name}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {!searching && searchResults.messages.length === 0 && searchResults.users.length === 0 && searchResults.channels.length === 0 && (
                  <p className="text-center text-fc-muted text-sm py-6">Aucun résultat</p>
                )}
              </>
            ) : (
              <p className="text-center text-fc-muted text-sm py-6">Tapez votre recherche...</p>
            )}
          </div>
          <div className="px-4 py-2 border-t border-fc-hover">
            <p className="text-[10px] text-fc-muted">Commencez par <kbd className="bg-fc-hover px-1 rounded">?</kbd> pour rechercher · <kbd className="bg-fc-hover px-1 rounded">Esc</kbd> pour fermer</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-[100] flex items-start justify-center pt-16 md:pt-24 px-3 md:px-0" onClick={onClose}>
      <div
        className="w-full max-w-[560px] bg-fc-channel border border-fc-hover rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-fc-hover">
          <Search size={18} className="text-fc-muted flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Aller à... (? pour rechercher)"
            className="flex-1 bg-transparent text-white placeholder-fc-muted outline-none text-sm"
          />
          <kbd className="text-xs text-fc-muted bg-fc-hover px-1.5 py-0.5 rounded">Échap</kbd>
        </div>

        {/* Résultats */}
        <div className="max-h-80 overflow-y-auto py-2">
          {!query && history.length > 0 && (
            <div className="mb-1">
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-xs font-semibold text-fc-muted uppercase tracking-wide">Recherches récentes</span>
                <button onClick={() => { clearHistory(); setHistory([]) }} className="text-xs text-fc-muted hover:text-white">Effacer tout</button>
              </div>
              {history.map(h => (
                <div key={h} className="flex items-center justify-between px-3 py-2 hover:bg-fc-hover cursor-pointer rounded-lg mx-1"
                     onClick={() => setQuery(h)}>
                  <span className="text-sm text-white">{h}</span>
                  <button onClick={e => { e.stopPropagation(); removeFromHistory(h); setHistory(loadHistory()) }}
                          className="text-fc-muted hover:text-white p-1">✕</button>
                </div>
              ))}
            </div>
          )}
          {filtered.length === 0 && (query || history.length === 0) && (
            <div className="px-4 py-6 text-center text-fc-muted text-sm">Aucun résultat</div>
          )}
          {filtered.map((r, i) => (
            <button
              key={`${r.type}-${r.id}`}
              onClick={() => go(r)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition
                ${i === selected ? 'bg-fc-accent/20 text-white' : 'text-fc-text hover:bg-fc-hover'}`}
            >
              <div className="flex-shrink-0">
                {r.type === 'dm'
                  ? <MessageCircle size={14} className="text-fc-green" />
                  : <ChannelIcon type={r.channelType ?? 'text'} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{r.name}</div>
                {r.serverName && (
                  <div className="text-xs text-fc-muted truncate">{r.serverName}</div>
                )}
              </div>
              <ChevronRight size={14} className="text-fc-muted flex-shrink-0" />
            </button>
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
