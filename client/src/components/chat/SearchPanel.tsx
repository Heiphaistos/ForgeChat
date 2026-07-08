import { useState, useRef } from 'react'
import { useSwipeRightToClose } from '../../hooks/useSwipeClose'
import { useEscapePanel } from '../../hooks/useEscapeKey'
import { X, Search, Hash, Loader2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import api from '../../api/client'
import { useFormatDate } from '../../hooks/useFormatDate'

interface Props {
  serverId: string
  channelId: string
  channelName: string
  onClose: () => void
}

export default function SearchPanel({ serverId, channelId, channelName, onClose }: Props) {
  useEscapePanel(onClose)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const nav = useNavigate()
  const { formatShortDate } = useFormatDate()

  const jumpToMessage = (msgId: string) => {
    if (serverId) {
      nav(`/servers/${serverId}/channels/${channelId}?highlight=${msgId}`)
    } else {
      nav(`/dms/${channelId}?highlight=${msgId}`)
    }
    onClose()
  }

  const searchUrl = serverId
    ? `/servers/${serverId}/channels/${channelId}/messages/search`
    : `/dms/${channelId}/messages/search`

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['search_messages', channelId, search],
    queryFn: () =>
      api.get(`${searchUrl}?q=${encodeURIComponent(search)}`).then(r => r.data),
    enabled: search.trim().length >= 2,
  })

  const handleSearch = () => {
    if (query.trim().length >= 2) setSearch(query.trim())
  }

  return (
    <div
      {...useSwipeRightToClose(onClose)}
      role="search"
      aria-label={`Rechercher dans #${channelName}`}
      className="absolute inset-0 z-10 md:relative md:inset-auto md:z-auto md:w-72 bg-fc-channel border-l border-fc-bg flex flex-col flex-shrink-0 panel-slide-right"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-fc-bg">
        <div className="flex items-center gap-2">
          <Search size={16} className="text-fc-accent" aria-hidden />
          <span className="font-semibold text-white text-sm">Rechercher</span>
        </div>
        <button onClick={onClose} aria-label="Fermer la recherche" className="p-1 text-fc-muted hover:text-white rounded hover:bg-fc-hover transition">
          <X size={16} aria-hidden />
        </button>
      </div>

      <div className="p-3 border-b border-fc-bg">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleSearch()
              else if (e.key === 'Escape') onClose()
            }}
            placeholder="Rechercher dans #..."
            aria-label={`Rechercher des messages dans #${channelName}`}
            inputMode="search" autoComplete="off"
            enterKeyHint="search" autoCapitalize="none"
            className="flex-1 px-3 py-1.5 bg-fc-input rounded text-sm text-white placeholder-fc-muted outline-none focus:ring-1 focus:ring-fc-accent"
            autoFocus
          />
          <button
            onClick={handleSearch}
            disabled={query.trim().length < 2}
            aria-label="Lancer la recherche"
            className="px-2.5 py-1.5 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm transition disabled:opacity-40"
          >
            <Search size={14} aria-hidden />
          </button>
        </div>
        {search && (
          <div className="flex items-center gap-1 mt-1.5 text-xs text-fc-muted">
            <Hash size={10} aria-hidden />
            <span>{channelName}</span>
            {isFetching && <Loader2 size={10} className="ml-auto animate-spin" aria-hidden />}
            {!isFetching && (
              <span aria-live="polite" aria-atomic="true" className="ml-auto">
                {results.length} résultat(s)
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain p-3 space-y-2">
        {!search && (
          <div className="text-center py-8">
            <Search size={28} className="mx-auto mb-2 text-fc-muted opacity-40" aria-hidden />
            <p className="text-sm text-fc-muted">Tapez votre recherche</p>
            <p className="text-xs text-fc-muted mt-1 opacity-70">Minimum 2 caractères</p>
          </div>
        )}

        {search && !isFetching && results.length === 0 && (
          <div role="status" className="text-center py-8">
            <p className="text-sm text-fc-muted">Aucun résultat pour "{search}"</p>
          </div>
        )}

        {results.length > 0 && (
          <div role="list" aria-label="Résultats de recherche" className="space-y-2">
            {results.map((msg: any) => (
              <div
                key={msg.id}
                role="listitem"
                onClick={() => jumpToMessage(msg.id)}
                aria-label={`Message de ${msg.author_username}`}
                className="bg-fc-bg rounded-lg p-3 border border-fc-hover cursor-pointer hover:border-fc-accent/50 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  {msg.author_avatar
                    ? <img src={msg.author_avatar} alt={msg.author_username} loading="lazy" decoding="async" className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
                    : <div className="w-5 h-5 rounded-full bg-fc-accent flex items-center justify-center text-xs font-bold text-white flex-shrink-0" aria-hidden>
                        {msg.author_username?.charAt(0).toUpperCase()}
                      </div>
                  }
                  <span className="text-xs font-semibold text-white">{msg.author_username}</span>
                  <span className="text-xs text-fc-muted ml-auto">
                    {formatShortDate(msg.created_at)}
                  </span>
                </div>
                <p className="text-xs text-fc-text leading-relaxed">
                  {highlightQuery(msg.content ?? '', search)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function highlightQuery(text: string, query: string) {
  if (!query) return text
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase()
          ? <mark key={i} className="bg-fc-accent/40 text-white rounded px-0.5">{part}</mark>
          : part
      )}
    </>
  )
}
