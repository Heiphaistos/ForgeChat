import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, X, Loader2 } from 'lucide-react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TENOR_KEY = (import.meta as any).env?.VITE_TENOR_API_KEY || ''
const TENOR_BASE = 'https://tenor.googleapis.com/v2'
const LIMIT = 20

// GIFs placeholder pour le mode démo (si Tenor inaccessible)
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

interface TenorResult {
  id: string
  title: string
  media_formats: {
    gif?: { url: string; dims: number[] }
    tinygif?: { url: string; dims: number[] }
    nanogif?: { url: string; dims: number[] }
  }
}

function parseTenorResults(results: TenorResult[]): TenorGif[] {
  return results.map(r => ({
    id: r.id,
    url: r.media_formats?.gif?.url ?? r.media_formats?.tinygif?.url ?? '',
    preview: r.media_formats?.tinygif?.url ?? r.media_formats?.nanogif?.url ?? r.media_formats?.gif?.url ?? '',
    title: r.title,
  }))
}

interface Props {
  onPick: (gifUrl: string) => void
  onClose: () => void
}

export default function GifPicker({ onPick, onClose }: Props) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [gifs, setGifs] = useState<TenorGif[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextPos, setNextPos] = useState<string | undefined>(undefined)
  const [hasMore, setHasMore] = useState(true)
  const [demoMode, setDemoMode] = useState(false)
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
      if (!TENOR_KEY) throw new Error('Tenor API key missing')
      const endpoint = query.trim()
        ? `${TENOR_BASE}/search?q=${encodeURIComponent(query)}&key=${TENOR_KEY}&limit=${LIMIT}&media_filter=gif${pos ? `&pos=${pos}` : ''}`
        : `${TENOR_BASE}/featured?key=${TENOR_KEY}&limit=${LIMIT}&media_filter=gif${pos ? `&pos=${pos}` : ''}`

      const res = await fetch(endpoint, { signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const parsed = parseTenorResults(data.results ?? [])

      setGifs(prev => append ? [...prev, ...parsed] : parsed)
      setNextPos(data.next)
      setHasMore(!!data.next && parsed.length === LIMIT)
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
    <div
      className="absolute bottom-full right-0 mb-2 bg-fc-channel border border-fc-hover rounded-xl shadow-2xl w-80 z-50 overflow-hidden flex flex-col"
      style={{ maxHeight: '420px' }}
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div className="p-2 border-b border-fc-hover flex-shrink-0">
        <div className="flex items-center gap-2 bg-fc-input rounded-lg px-2 py-1.5">
          <Search size={14} className="text-fc-muted flex-shrink-0" />
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Chercher un GIF..."
            className="bg-transparent text-sm text-white outline-none flex-1 placeholder-fc-muted"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-fc-muted hover:text-white transition">
              <X size={12} />
            </button>
          )}
        </div>
        {demoMode && (
          <p className="text-xs text-fc-muted mt-1 text-center">Mode démo — Tenor inaccessible</p>
        )}
        {!demoMode && !search && (
          <p className="text-xs text-fc-muted mt-1 text-center font-medium">Trending</p>
        )}
      </div>

      {/* Grille GIFs */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="overflow-y-auto flex-1"
        style={{ minHeight: 0 }}
      >
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-fc-muted">
            <Loader2 size={24} className="animate-spin" />
            <span className="text-xs">Chargement...</span>
          </div>
        ) : gifs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-fc-muted">
            <span className="text-3xl">🔍</span>
            <span className="text-xs">Aucun GIF trouvé</span>
          </div>
        ) : demoMode ? (
          // Mode démo : grille d'emojis géants
          <div className="grid grid-cols-2 gap-2 p-2">
            {gifs.map(gif => (
              <button
                key={gif.id}
                onClick={() => handlePick(gif)}
                className="flex flex-col items-center justify-center gap-1 h-20 rounded-lg bg-fc-hover hover:bg-fc-input transition border border-fc-hover hover:border-fc-accent"
              >
                <span className="text-4xl">{gif.emoji}</span>
                <span className="text-xs text-fc-muted">{gif.title}</span>
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
                  className="relative rounded overflow-hidden group hover:opacity-90 transition bg-fc-hover"
                  title={gif.title}
                >
                  <img
                    src={gif.preview || gif.url}
                    alt={gif.title}
                    className="w-full object-cover rounded"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition rounded" />
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-1.5 flex-1">
              {rightCol.map(gif => (
                <button
                  key={gif.id}
                  onClick={() => handlePick(gif)}
                  className="relative rounded overflow-hidden group hover:opacity-90 transition bg-fc-hover"
                  title={gif.title}
                >
                  <img
                    src={gif.preview || gif.url}
                    alt={gif.title}
                    className="w-full object-cover rounded"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition rounded" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Loader infinite scroll */}
        {loadingMore && (
          <div className="flex justify-center py-3">
            <Loader2 size={16} className="animate-spin text-fc-muted" />
          </div>
        )}
      </div>
    </div>
  )
}
