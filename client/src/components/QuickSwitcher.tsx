import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, Hash, Volume2, Video, Megaphone, MessagesSquare, Images, Radio, MessageCircle, ChevronRight, Users } from 'lucide-react'
import api, { mediaUrl } from '../api/client'
import { useKeyboardNav } from '../hooks/useKeyboardNav'
import { messageLink } from '../utils/searchLink'
import { useT } from '../i18n'

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
  type: 'channel' | 'dm' | 'group'
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
    case 'media': return <Images size={14} className="text-green-400" />
    case 'stage': return <Radio size={14} className="text-red-400" />
    default: return <Hash size={14} className="text-fc-muted" />
  }
}

export default function QuickSwitcher({ onClose }: Props) {
  const tr = useT()
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
    // /dms mélange DMs 1:1 (username) et groupes (is_group + name)
    const label: string = dm.is_group ? (dm.name ?? tr('qs.group')) : (dm.username ?? '')
    if (!label) continue
    if (!query || label.toLowerCase().includes(query.toLowerCase())) {
      results.push({
        type: dm.is_group ? 'group' : 'dm',
        id: dm.id,
        name: label,
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
    } else if (r.type === 'group') {
      nav(`/dms/groups/${r.id}`)
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
        <div role="dialog" aria-modal="true" aria-label={tr('qs.globalSearch')} className="bg-fc-sidebar border border-fc-hover rounded-xl w-full max-w-xl shadow-2xl" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-3 px-4 py-3 border-b border-fc-hover">
            <Search size={16} className="text-fc-muted flex-shrink-0" aria-hidden />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') onClose() }}
              placeholder={tr('qs.searchPh')}
              inputMode="search" autoComplete="off"
              aria-label={tr('qs.searchA11y')}
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
                    <p className="text-[10px] text-fc-muted uppercase font-semibold tracking-wide px-2 mb-1">{tr('qs.messages')}</p>
                    {searchResults.messages.map((m: any) => (
                      <button key={m.id}
                        onClick={() => { nav(messageLink(m)); onClose() }}
                        className="w-full flex items-start gap-2 px-2 py-2 rounded hover:bg-fc-hover text-left transition">
                        <Hash size={13} className="text-fc-muted mt-0.5 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1 text-xs text-fc-muted">
                            <span className="font-medium text-white">{m.author_username}</span>
                            <span>{tr('qs.in', { where: `${m.kind === 'channel' || !m.kind ? '#' : ''}${m.channel_name}` })}</span>
                          </div>
                          <p className="text-sm text-fc-text truncate">{m.content}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {searchResults.users.length > 0 && (
                  <div>
                    <p className="text-[10px] text-fc-muted uppercase font-semibold tracking-wide px-2 mb-1">{tr('qs.users')}</p>
                    {searchResults.users.map((u: any) => (
                      <button key={u.id}
                        onClick={() => { nav(`/users/${u.id}`); onClose() }}
                        className="w-full flex items-center gap-2 px-2 py-2 rounded hover:bg-fc-hover transition">
                        <div className="w-7 h-7 rounded-full bg-fc-accent flex-shrink-0 flex items-center justify-center text-xs font-bold text-white overflow-hidden">
                          {u.avatar ? <img src={mediaUrl(u.avatar)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" /> : u.username.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm text-white">{u.username}</span>
                      </button>
                    ))}
                  </div>
                )}
                {searchResults.channels.length > 0 && (
                  <div>
                    <p className="text-[10px] text-fc-muted uppercase font-semibold tracking-wide px-2 mb-1">{tr('qs.channels')}</p>
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
                  <p className="text-center text-fc-muted text-sm py-6">{tr('qs.noResult')}</p>
                )}
              </>
            ) : (
              <p className="text-center text-fc-muted text-sm py-6">{tr('qs.typeSearch')}</p>
            )}
          </div>
          <div className="px-4 py-2 border-t border-fc-hover">
            <p className="text-[10px] text-fc-muted">{tr('qs.hintStart')} <kbd className="bg-fc-hover px-1 rounded">?</kbd> {tr('qs.hintSearch')} · <kbd className="bg-fc-hover px-1 rounded">{tr('qs.esc')}</kbd> {tr('qs.hintClose')}</p>
          </div>
        </div>
      </div>
    )
  }

  const activeItemId = selected >= 0 && selected < filtered.length
    ? `qs-item-${filtered[selected].type}-${filtered[selected].id}`
    : undefined

  return (
    <div className="fixed inset-0 bg-black/70 z-[100] flex items-start justify-center pt-16 md:pt-24 px-3 md:px-0" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tr('qs.title')}
        className="w-full max-w-[560px] bg-fc-channel border border-fc-hover rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-fc-hover">
          <Search size={18} className="text-fc-muted flex-shrink-0" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder={tr('qs.gotoPh')}
            role="combobox"
            aria-expanded={filtered.length > 0}
            aria-controls="qs-listbox"
            aria-activedescendant={activeItemId}
            aria-label={tr('qs.gotoA11y')}
            enterKeyHint="go"
            inputMode="search"
            autoCapitalize="none"
            className="flex-1 bg-transparent text-white placeholder-fc-muted outline-none text-sm"
          />
          <kbd className="text-xs text-fc-muted bg-fc-hover px-1.5 py-0.5 rounded" aria-hidden>{tr('qs.esc')}</kbd>
        </div>

        {/* Résultats */}
        <div id="qs-listbox" role="listbox" aria-label={tr('qs.listA11y')} className="max-h-80 overflow-y-auto overscroll-contain py-2">
          {!query && history.length > 0 && (
            <div className="mb-1" role="group" aria-label={tr('qs.recent')}>
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-xs font-semibold text-fc-muted uppercase tracking-wide" aria-hidden>{tr('qs.recent')}</span>
                <button onClick={() => { clearHistory(); setHistory([]) }} aria-label={tr('qs.clearHistory')} className="text-xs text-fc-muted hover:text-white">{tr('qs.clearAll')}</button>
              </div>
              {history.map(h => (
                <div key={h} className="flex items-center justify-between px-3 py-2 hover:bg-fc-hover rounded-lg mx-1">
                  {/* Vrai bouton (clavier, lecteur d'écran) au lieu d'une ligne cliquable */}
                  <button type="button" onClick={() => setQuery(h)} aria-label={tr('qs.useHistory', { q: h })} className="flex-1 text-left text-sm text-white truncate">{h}</button>
                  <button onClick={() => { removeFromHistory(h); setHistory(loadHistory()) }}
                          aria-label={tr('qs.removeHistory', { q: h })}
                          className="text-fc-muted hover:text-white p-1">✕</button>
                </div>
              ))}
            </div>
          )}
          {filtered.length === 0 && (query || history.length === 0) && (
            <div role="status" className="px-4 py-6 text-center text-fc-muted text-sm">{tr('qs.noResult')}</div>
          )}
          {filtered.map((r, i) => (
            <button
              key={`${r.type}-${r.id}`}
              id={`qs-item-${r.type}-${r.id}`}
              role="option"
              aria-selected={i === selected}
              onClick={() => go(r)}
              onMouseEnter={() => setSelected(i)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition
                ${i === selected ? 'bg-fc-accent/20 text-white' : 'text-fc-text hover:bg-fc-hover'}`}
            >
              <div className="flex-shrink-0" aria-hidden>
                {r.type === 'dm'
                  ? <MessageCircle size={14} className="text-fc-green" />
                  : r.type === 'group'
                  ? <Users size={14} className="text-fc-accent" />
                  : <ChannelIcon type={r.channelType ?? 'text'} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{r.name}</div>
                {r.serverName && (
                  <div className="text-xs text-fc-muted truncate">{r.serverName}</div>
                )}
              </div>
              <ChevronRight size={14} className="text-fc-muted flex-shrink-0" aria-hidden />
            </button>
          ))}
        </div>

        <div className="px-4 py-2 border-t border-fc-hover flex items-center gap-4 text-xs text-fc-muted" aria-hidden>
          <span><kbd className="bg-fc-hover px-1 rounded">↑↓</kbd> {tr('qs.navigate')}</span>
          <span><kbd className="bg-fc-hover px-1 rounded">{tr('qs.enter')}</kbd> {tr('qs.open')}</span>
          <span><kbd className="bg-fc-hover px-1 rounded">{tr('qs.esc')}</kbd> {tr('qs.close')}</span>
        </div>
      </div>
    </div>
  )
}
