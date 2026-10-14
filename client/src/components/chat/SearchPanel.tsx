import { useState, useRef, useEffect, useMemo } from 'react'
import { useSwipeRightToClose } from '../../hooks/useSwipeClose'
import { useEscapePanel } from '../../hooks/useEscapeKey'
import { X, Search, Hash, Loader2 } from 'lucide-react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import api, { mediaUrl } from '../../api/client'
import { stripMarkdown } from '../../utils/mdShortcuts'
import { useFormatDate } from '../../hooks/useFormatDate'
import { messageLink } from '../../utils/searchLink'
import { useT, type Key } from '../../i18n'
import type { IndexedMsg } from '../../e2e/searchQuery'
import { lockedText } from '../../e2e/conversations'
import { clearSearchIndex, countIndexed, searchLocal } from '../../e2e/searchIndex'
import toast from 'react-hot-toast'

const FILTER_HELP: [Key, Key][] = [
  ['hc.sp.key.from', 'hc.sp.f.from'],
  ['hc.sp.key.in', 'hc.sp.f.in'],
  ['hc.sp.key.has', 'hc.sp.f.has'],
  ['hc.sp.key.before', 'hc.sp.f.before'],
  ['hc.sp.key.after', 'hc.sp.f.after'],
]

/** Portée : cette conversation, tous les MP et groupes, tous les salons de serveur, partout. */
type Scope = 'here' | 'dms' | 'servers' | 'all'
const SCOPE_LABEL: Record<Scope, Key> = { here: 'ux.search.here', dms: 'ux.search.dms', servers: 'ux.search.servers', all: 'ux.search.all' }
const LOCAL_KINDS: Partial<Record<Scope, IndexedMsg['kind'][]>> = { dms: ['dm', 'group'], servers: ['channel'] }

interface Props {
  serverId: string
  channelId: string
  channelName: string
  onClose: () => void
  /** Conversation chiffrée : le serveur ne peut pas chercher, on filtre les messages déjà déchiffrés. */
  localMessages?: readonly { id: string; content: string | null; created_at: string; author_username?: string; author_avatar?: string | null; e2e?: string }[]
  /**
   * Salon chiffré : les messages chargés sont filtrés ici, et le serveur cherche
   * quand même (messages en clair, filtres from:/has:/before:…).
   */
  channelEncrypted?: boolean
}

export default function SearchPanel({ serverId, channelId, channelName, onClose, localMessages, channelEncrypted }: Props) {
  useEscapePanel(onClose)
  const t = useT()
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [scope, setScope] = useState<Scope>('here')
  const everywhere = scope !== 'here'
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
    queryKey: ['search_messages', everywhere ? scope : channelId, search],
    queryFn: ({ pageParam }) => api.get('/search', {
      params: {
        q: search,
        cursor: pageParam || undefined,
        ...(scope === 'all' ? {} : everywhere ? { scope } : serverId ? { channel_id: channelId } : { dm_id: channelId }),
      },
    }).then(r => r.data as { messages: any[]; next_cursor: string | null }),
    initialPageParam: '',
    getNextPageParam: last => last.next_cursor ?? undefined,
    enabled: search.trim().length >= 2 && !(localMessages && !everywhere && !channelEncrypted),
  })
  // Index local des messages déjà déchiffrés sur cet appareil (texte jamais envoyé au serveur).
  const qc = useQueryClient()
  const { data: indexed = [] } = useQuery({
    queryKey: ['search_local', everywhere ? scope : channelId, search],
    queryFn: async () => (await searchLocal(search, everywhere ? undefined : channelId, LOCAL_KINDS[scope])).map(m => ({
      id: m.id, content: m.text, created_at: m.createdAt, author_username: m.authorName, author_avatar: null,
      kind: m.kind, channel_id: m.convId, server_id: m.serverId ?? undefined, channel_name: m.convName ?? '',
    })),
    enabled: search.trim().length >= 2,
    staleTime: 5_000,
  })
  const { data: indexedCount = 0 } = useQuery({ queryKey: ['search_local_count'], queryFn: countIndexed, enabled: !search, staleTime: 10_000 })
  // MP/groupe chiffré : uniquement local ; salon chiffré : local + serveur.
  const localOnly = !!localMessages && !everywhere && !channelEncrypted
  const highlightText = useMemo(() => search.split(/\s+/).filter(w => !/^[a-z]+:\S+/i.test(w)).join(' '), [search])
  const results = useMemo(() => {
    const q = highlightText.trim().toLowerCase()
    const local = !localMessages || everywhere || q.length < 2 ? [] : localMessages
      .filter(m => m.e2e !== 'locked' && (m.content ?? '').toLowerCase().includes(q))
      .map(m => ({ ...m, kind: serverId ? 'channel' : 'dm', channel_id: channelId, server_id: serverId || undefined }))
      .reverse()
    // Résultat chiffré du serveur (filtres seulement) : texte déchiffré s'il est chargé ou indexé, sinon texte d'attente.
    const loaded = new Map<string, string | null>([...indexed, ...(localMessages ?? [])].map(m => [m.id, m.content]))
    const server = localOnly ? [] : (data?.pages.flatMap(p => p.messages) ?? [])
      .map(m => m.content == null ? { ...m, content: loaded.get(m.id) ?? lockedText() } : m)
    const seen = new Set<string>()
    return [...server, ...local, ...indexed]
      .filter(m => !seen.has(m.id) && !!seen.add(m.id))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
  }, [data, localMessages, everywhere, highlightText, channelId, serverId, localOnly, indexed])

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
          <span className="font-semibold text-white text-sm">{t('hc.sp.title')}</span>
        </div>
        <button onClick={onClose} aria-label={t('hc.sp.close')} className="p-1 text-fc-muted hover:text-white rounded hover:bg-fc-hover transition">
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
            placeholder={t('hc.sp.ph')}
            aria-label={`Rechercher des messages dans #${channelName}`}
            inputMode="search" autoComplete="off"
            enterKeyHint="search" autoCapitalize="none"
            className="flex-1 px-3 py-1.5 bg-fc-input rounded text-sm text-white placeholder-fc-muted outline-none focus:ring-1 focus:ring-fc-accent"
            autoFocus
          />
          <button
            onClick={handleSearch}
            disabled={query.trim().length < 2}
            aria-label={t('hc.sp.go')}
            className="px-2.5 py-1.5 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm transition disabled:opacity-40"
          >
            <Search size={14} aria-hidden />
          </button>
        </div>
        <div role="radiogroup" aria-label={t('ux.search.scope')} className="flex flex-wrap gap-1 mt-2">
          {(Object.keys(SCOPE_LABEL) as Scope[]).map(id => (
            <button key={id} type="button" role="radio" aria-checked={scope === id} onClick={() => setScope(id)}
              className={`px-2 py-0.5 rounded-full text-xs border transition ${scope === id ? 'border-fc-accent bg-fc-accent/15 text-white' : 'border-fc-hover text-fc-muted hover:text-white'}`}>
              {t(SCOPE_LABEL[id])}
            </button>
          ))}
        </div>
        {localMessages && !everywhere && <p className="mt-1.5 text-xs text-fc-muted">{t(channelEncrypted ? 'e2e.search.channelLocal' : 'e2e.search.local')}</p>}
        {search && (
          <div className="flex items-center gap-1 mt-1.5 text-xs text-fc-muted">
            <Hash size={10} aria-hidden />
            <span>{everywhere ? t(SCOPE_LABEL[scope]) : channelName}</span>
            {isFetching && <Loader2 size={10} className="ml-auto animate-spin" aria-hidden />}
            {!isFetching && (
              <span aria-live="polite" aria-atomic="true" className="ml-auto">
                {t('hc.sp.count', { n: `${results.length}${hasNextPage ? '+' : ''}` })}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain p-3 space-y-2">
        {!search && (
          <div className="text-center py-8">
            <Search size={28} className="mx-auto mb-2 text-fc-muted opacity-40" aria-hidden />
            <p className="text-sm text-fc-muted">{t('hc.sp.type')}</p>
            <p className="text-xs text-fc-muted mt-1 opacity-70">{t('hc.sp.min')}</p>
            <ul className="mt-4 text-left text-xs text-fc-muted space-y-1" aria-label={t('hc.sp.filters')}>
              {FILTER_HELP.map(([k, d]) => (
                <li key={k}><code className="text-fc-text bg-fc-bg px-1 rounded">{t(k)}</code> {t(d)}</li>
              ))}
            </ul>
            <div className="mt-4 text-left text-xs text-fc-muted space-y-1">
              <p className="font-semibold text-fc-text">{t('lsearch.title')}</p>
              <p>{t('lsearch.hint')}</p>
              <p>{t('lsearch.filters')}</p>
              <p>{t('lsearch.count', { n: indexedCount })}</p>
              {indexedCount > 0 && (
                <button type="button" className="text-fc-accent hover:underline"
                  onClick={() => void clearSearchIndex().then(() => {
                    qc.invalidateQueries({ queryKey: ['search_local_count'] })
                    toast.success(t('lsearch.cleared'))
                  })}>
                  {t('lsearch.clear')}
                </button>
              )}
            </div>
          </div>
        )}

        {search && !isFetching && results.length === 0 && (
          <div role="status" className="text-center py-8">
            <p className="text-sm text-fc-muted">{t('hc.sp.none', { q: search })}</p>
          </div>
        )}

        {results.length > 0 && (
          <div role="listbox" aria-label={t('hc.sp.results')} className="space-y-2">
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
            {isFetchingNextPage ? t('hc.thr.loadingShort') : t('hc.sp.more')}
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
