import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, Hash, Volume2, Video, Megaphone, MessagesSquare, Radio, MessageCircle, ChevronRight } from 'lucide-react'
import api from '../api/client'
import { useKeyboardNav } from '../hooks/useKeyboardNav'

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
  const nav = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)

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
    for (const ch of srv.channels ?? []) {
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

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return }
    navKey(e.nativeEvent)
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-[100] flex items-start justify-center pt-24" onClick={onClose}>
      <div
        className="w-[560px] bg-fc-channel border border-fc-hover rounded-xl shadow-2xl overflow-hidden"
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
            placeholder="Aller à un canal, un DM..."
            className="flex-1 bg-transparent text-white placeholder-fc-muted outline-none text-sm"
          />
          <kbd className="text-xs text-fc-muted bg-fc-hover px-1.5 py-0.5 rounded">Échap</kbd>
        </div>

        {/* Résultats */}
        <div className="max-h-80 overflow-y-auto py-2">
          {filtered.length === 0 && (
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
