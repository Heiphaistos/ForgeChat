import { useState, useEffect, useRef, useCallback } from 'react'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import PickerShell from '../ui/PickerShell'
import { Search, X, Loader2 } from 'lucide-react'

import api from '../../api/client'

// GIF via le serveur (routes /api/gifs/* : GIPHY, ou Wikimedia Commons sans clé) : la clé API reste
// sur le serveur. L'API Tenor appelée auparavant depuis le navigateur a fermé le 30/06/2026.

// GIFs placeholder pour le mode démo (GIF non configurés sur le serveur ou indisponibles)
const DEMO_GIFS = [
  { id: 'demo1', url: '', preview: '', title: '😀 Heureux', emoji: '😀' },
  { id: 'demo2', url: '', preview: '', title: '😂 Rire', emoji: '😂' },
  { id: 'demo3', url: '', preview: '', title: '😍 Amour', emoji: '😍' },
  { id: 'demo4', url: '', preview: '', title: '🔥 Feu', emoji: '🔥' },
  { id: 'demo5', url: '', preview: '', title: '🎉 Fête', emoji: '🎉' },
  { id: 'demo6', url: '', preview: '', title: '👍 OK', emoji: '👍' },
  { id: 'demo7', url: '', preview: '', title: '😎 Cool', emoji: '😎' },
  { id: 'demo8', url: '', preview: '', title: '🤔 Hmm', emoji: '🤔' },
  { id: 'demo9', url: '', preview: '', title: '😭 Pleurs', emoji: '😭' },
  { id: 'demo10', url: '', preview: '', title: '🚀 Fusée', emoji: '🚀' },
]

interface TenorGif {
  id: string
  url: string
  preview: string
  title: string
  emoji?: string
}

interface Props {
  onPick: (gifUrl: string) => void
  onClose: () => void
}

export default function GifPicker({ onPick, onClose }: Props) {
  useEscapeKey(onClose)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [gifs, setGifs] = useState<TenorGif[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextPos, setNextPos] = useState<string | undefined>(undefined)
  const [hasMore, setHasMore] = useState(true)
  const [demoMode, setDemoMode] = useState(false)
  // Source annoncée par le serveur (texte du champ et mention exigée par GIPHY).
  const [source, setSource] = useState({ placeholder: 'Rechercher un GIF', attribution: '' })
  useEffect(() => {
    api.get('/gifs/status').then(({ data }) => setSource({
      placeholder: typeof data?.search_placeholder === 'string' ? data.search_placeholder : 'Rechercher un GIF',
      attribution: typeof data?.attribution === 'string' ? data.attribution : '',
    })).catch(() => {})
  }, [])
  const scrollRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  // Debounce 500ms
  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search)
    }, 500)
    return () => clearTimeout(debounceRef.current)
  }, [search])

  const fetchGifs = useCallback(async (query: string, pos?: string, append = false, signal?: AbortSignal) => {
    if (!append) {
      setLoading(true)
      setGifs([])
      setNextPos(undefined)
      setHasMore(true)
    } else {
      setLoadingMore(true)
    }

    try {
      const { data } = query.trim()
        ? await api.get('/gifs/search', { params: { q: query, pos }, signal })
        : await api.get('/gifs/trending', { params: { pos }, signal })
      const parsed: TenorGif[] = (data.results ?? []).map((r: { id: string; url: string; preview: string; title: string }) => ({
        id: r.id, url: r.url, preview: r.preview, title: r.title,
      }))
      setGifs(prev => append ? [...prev, ...parsed] : parsed)
      setNextPos(data.next ?? undefined)
      // Wikimedia peut renvoyer moins de 24 résultats (images non animées écartées) : seul « next » compte.
      setHasMore(!!data.next)
      setDemoMode(false)
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return
      if (!append) {
        setGifs(DEMO_GIFS)
        setDemoMode(true)
        setHasMore(false)
      }
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    fetchGifs(debouncedSearch, undefined, false, ctrl.signal)
    return () => ctrl.abort()
  }, [debouncedSearch, fetchGifs])

  // Infinite scroll
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el || loadingMore || !hasMore || demoMode) return
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (fromBottom < 80) {
      fetchGifs(debouncedSearch, nextPos, true)
    }
  }, [loadingMore, hasMore, demoMode, fetchGifs, debouncedSearch, nextPos])

  // Colonnes masonry alternées : col gauche et col droite
  const leftCol = gifs.filter((_, i) => i % 2 === 0)
  const rightCol = gifs.filter((_, i) => i % 2 === 1)

  const handlePick = (gif: TenorGif) => {
    if (gif.url) {
      onPick(gif.url)
    } else {
      // Mode démo : envoie le nom/emoji comme texte
      onPick(gif.title)
    }
    onClose()
  }

  return (
    <PickerShell
      onClose={onClose}
      desktopClassName="absolute bottom-full right-0 mb-2 bg-fc-channel border border-fc-hover rounded-xl shadow-2xl w-80 z-50 overflow-hidden flex flex-col"
      desktopStyle={{ maxHeight: '420px' }}
    >
      {/* Header */}
      <div role="search" aria-label="Chercher un GIF" className="p-2 border-b border-fc-hover flex-shrink-0">
        <div className="flex items-center gap-2 bg-fc-input rounded-lg px-2 py-1.5">
          <Search size={14} aria-hidden className="text-fc-muted flex-shrink-0" />
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={source.placeholder}
            aria-label="Chercher un GIF"
            enterKeyHint="search"
            inputMode="search"
            autoComplete="off"
            autoCapitalize="none"
            className="bg-transparent text-sm text-white outline-none flex-1 placeholder-fc-muted"
          />
          {search && (
            <button onClick={() => setSearch('')} aria-label="Effacer la recherche" className="text-fc-muted hover:text-white transition">
              <X size={12} aria-hidden />
            </button>
          )}
        </div>
        {demoMode && (
          <p className="text-xs text-fc-muted mt-1 text-center">GIF indisponibles (non configurés sur le serveur)</p>
        )}
        {!demoMode && !search && (
          <p className="text-xs text-fc-muted mt-1 text-center font-medium" aria-hidden>Trending</p>
        )}
      </div>

      {/* Grille GIFs */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="overflow-y-auto overscroll-contain flex-1"
        style={{ minHeight: 0 }}
      >
        {loading ? (
          <div role="status" aria-label="Chargement des GIFs" className="flex flex-col items-center justify-center gap-2 py-10 text-fc-muted">
            <Loader2 size={24} aria-hidden className="animate-spin" />
            <span className="text-xs" aria-hidden>Chargement...</span>
          </div>
        ) : gifs.length === 0 ? (
          <div role="status" className="flex flex-col items-center justify-center gap-2 py-10 text-fc-muted">
            <span className="text-3xl" aria-hidden>🔍</span>
            <span className="text-xs">Aucun GIF trouvé</span>
          </div>
        ) : demoMode ? (
          // Mode démo : grille d'emojis géants
          <div className="grid grid-cols-2 gap-2 p-2">
            {gifs.map(gif => (
              <button
                key={gif.id}
                onClick={() => handlePick(gif)}
                aria-label={gif.title}
                className="flex flex-col items-center justify-center gap-1 h-20 rounded-lg bg-fc-hover hover:bg-fc-input transition border border-fc-hover hover:border-fc-accent"
              >
                <span className="text-4xl" aria-hidden>{gif.emoji}</span>
                <span className="text-xs text-fc-muted" aria-hidden>{gif.title}</span>
              </button>
            ))}
          </div>
        ) : (
          // Grille masonry 2 colonnes
          <div className="flex gap-1.5 p-2">
            <div className="flex flex-col gap-1.5 flex-1">
              {leftCol.map(gif => (
                <button
                  key={gif.id}
                  onClick={() => handlePick(gif)}
                  aria-label={gif.title}
                  className="relative rounded overflow-hidden group hover:opacity-90 transition bg-fc-hover"
                >
                  <img
                    src={gif.preview || gif.url}
                    alt={gif.title}
                    className="w-full object-cover rounded"
                    loading="lazy"
                  />
                  <div aria-hidden className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition rounded" />
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-1.5 flex-1">
              {rightCol.map(gif => (
                <button
                  key={gif.id}
                  onClick={() => handlePick(gif)}
                  aria-label={gif.title}
                  className="relative rounded overflow-hidden group hover:opacity-90 transition bg-fc-hover"
                >
                  <img
                    src={gif.preview || gif.url}
                    alt={gif.title}
                    className="w-full object-cover rounded"
                    loading="lazy"
                  />
                  <div aria-hidden className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition rounded" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Loader infinite scroll */}
        {loadingMore && (
          <div role="status" aria-label="Chargement de GIFs supplémentaires" className="flex justify-center py-3">
            <Loader2 size={16} aria-hidden className="animate-spin text-fc-muted" />
          </div>
        )}
      </div>
    {source.attribution && !demoMode && (
        <p className="px-2 py-1 border-t border-fc-hover text-[10px] text-fc-muted text-right flex-shrink-0">{source.attribution}</p>
      )}
    </PickerShell>
  )
}
