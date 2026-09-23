import { useState, useRef, useEffect, useMemo } from 'react'
import { useSwipeRightToClose } from '../../hooks/useSwipeClose'
import { useEscapePanel } from '../../hooks/useEscapeKey'
import { X, Search, Hash, Loader2 } from 'lucide-react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import api, { mediaUrl } from '../../api/client'
import { stripMarkdown } from '../../utils/mdShortcuts'
import { useFormatDate } from '../../hooks/useFormatDate'
import { messageLink } from '../../utils/searchLink'

const FILTER_HELP = [
  ['from:pseudo', 'messages de cet auteur'],
  ['in:salon', 'dans ce salon, groupe ou DM (en recherche partout)'],
  ['has:fichier | image | lien', 'avec pièce jointe, image ou lien'],
  ['before:2026-01-31', 'avant cette date'],
  ['after:2026-01-01', 'après cette date'],
]

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
  // Portée : ce salon/DM, ou partout (salons visibles, DM et groupes).
  const [everywhere, setEverywhere] = useState(false)
  // Navigation clavier dans les résultats (↑/↓ depuis le champ, Entrée pour ouvrir)
  const [selIdx, setSelIdx] = useState(-1)
  const itemRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const nav = useNavigate()
  const { formatShortDate } = useFormatDate()

  const jumpToMessage = (msg: any) => {
    nav(messageLink(msg))
    onClose()
  }

  // Recherche paginée par curseur, filtres analysés par le serveur.
  const { data, isFetching, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['search_messages', everywhere ? 'all' : channelId, search],
    queryFn: ({ pageParam }) => api.get('/search', {
      params: {
        q: search,
        cursor: pageParam || undefined,
        ...(everywhere ? {} : serverId ? { channel_id: channelId } : { dm_id: channelId }),
      },
    }).then(r => r.data as { messages: any[]; next_cursor: string | null }),
    initialPageParam: '',
    getNextPageParam: last => last.next_cursor ?? undefined,
    enabled: search.trim().length >= 2,
  })
  const results = useMemo(() => data?.pages.flatMap(p => p.messages) ?? [], [data])
  const highlightText = useMemo(() => search.split(/\s+/).filter(w => !/^[a-z]+:\S+/i.test(w)).join(' '), [search])

  // Réinitialiser la sélection à chaque nouvelle liste de résultats
  useEffect(() => { setSelIdx(-1) }, [results])

  // Garder le résultat sélectionné visible
  useEffect(() => {
    if (selIdx >= 0) itemRefs.current[selIdx]?.scrollIntoView({ block: 'nearest' })
  }, [selIdx])

  const handleSearch = () => {
    if (query.trim().length >= 2) setSearch(query.trim().replace(/\s+/g, ' '))
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
              if (e.key === 'ArrowDown' && results.length > 0) {
                e.preventDefault()
                setSelIdx(i => Math.min(i + 1, results.length - 1))
              } else if (e.key === 'ArrowUp' && results.length > 0) {
                e.preventDefault()
                setSelIdx(i => Math.max(i - 1, -1))
              } else if (e.key === 'Enter') {
                if (selIdx >= 0 && results[selIdx]) jumpToMessage(results[selIdx])
                else handleSearch()
              } else if (e.key === 'Escape') onClose()
            }}
            aria-activedescendant={selIdx >= 0 && results[selIdx] ? `search-result-${results[selIdx].id}` : undefined}
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
        <label className="flex items-center gap-1.5 mt-2 text-xs text-fc-muted cursor-pointer select-none">
          <input type="checkbox" checked={everywhere} onChange={e => setEverywhere(e.target.checked)} className="accent-fc-accent" />
          Chercher partout (salons, messages privés, groupes)
        </label>
        {search && (
          <div className="flex items-center gap-1 mt-1.5 text-xs text-fc-muted">
            <Hash size={10} aria-hidden />
            <span>{everywhere ? 'Partout' : channelName}</span>
            {isFetching && <Loader2 size={10} className="ml-auto animate-spin" aria-hidden />}
            {!isFetching && (
              <span aria-live="polite" aria-atomic="true" className="ml-auto">
                {results.length}{hasNextPage ? '+' : ''} résultat(s)
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
            <p className="text-xs text-fc-muted mt-1 opacity-70">Minimum 2 caractères, ou un filtre</p>
            <ul className="mt-4 text-left text-xs text-fc-muted space-y-1" aria-label="Filtres disponibles">
              {FILTER_HELP.map(([k, d]) => (
                <li key={k}><code className="text-fc-text bg-fc-bg px-1 rounded">{k}</code> {d}</li>
              ))}
            </ul>
          </div>
        )}

        {search && !isFetching && results.length === 0 && (
          <div role="status" className="text-center py-8">
            <p className="text-sm text-fc-muted">Aucun résultat pour "{search}"</p>
          </div>
        )}

        {results.length > 0 && (
          <div role="listbox" aria-label="Résultats de recherche" className="space-y-2">
            {results.map((msg: any, idx: number) => (
              <div
                key={msg.id}
                id={`search-result-${msg.id}`}
                ref={el => { itemRefs.current[idx] = el }}
                role="option"
                aria-selected={idx === selIdx}
                tabIndex={0}
                onClick={() => jumpToMessage(msg)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    jumpToMessage(msg)
                  }
                }}
                aria-label={`Message de ${msg.author_username}`}
                className={`bg-fc-bg rounded-lg p-3 border cursor-pointer transition-colors focus:outline-none focus:border-fc-accent/70 ${
                  idx === selIdx ? 'border-fc-accent bg-fc-hover/30' : 'border-fc-hover hover:border-fc-accent/50'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  {msg.author_avatar
                    ? <img src={mediaUrl(msg.author_avatar)} alt={msg.author_username} loading="lazy" decoding="async" className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
                    : <div className="w-5 h-5 rounded-full bg-fc-accent flex items-center justify-center text-xs font-bold text-white flex-shrink-0" aria-hidden>
                        {msg.author_username?.charAt(0).toUpperCase()}
                      </div>
                  }
                  <span className="text-xs font-semibold text-white">{msg.author_username}</span>
                  {everywhere && <span className="text-[10px] text-fc-muted truncate">{msg.kind === 'channel' ? '#' : ''}{msg.channel_name}</span>}
                  <span className="text-xs text-fc-muted ml-auto">
                    {formatShortDate(msg.created_at)}
                  </span>
                </div>
                <p className="text-xs text-fc-text leading-relaxed">
                  {highlightQuery(stripMarkdown(msg.content ?? ''), highlightText)}
                </p>
              </div>
            ))}
          </div>
        )}
        {hasNextPage && (
          <button onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}
            className="w-full py-2 text-xs text-fc-accent hover:text-white hover:bg-fc-hover rounded transition disabled:opacity-50">
            {isFetchingNextPage ? 'Chargement…' : 'Charger plus'}
          </button>
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
