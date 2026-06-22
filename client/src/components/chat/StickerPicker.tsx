import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, X, Loader2 } from 'lucide-react'
import api from '../../api/client'
import toast from 'react-hot-toast'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Sticker {
  id: string
  name: string
  category: string
  // Emoji stickers (Global)
  emoji?: string
  // Image stickers (Serveur)
  url?: string
}

interface ServerSticker {
  id: string
  name: string
  description?: string
  url: string
  uploaded_by?: string
  created_at: string
}

interface Props {
  serverId?: string
  onPick: (sticker: Sticker) => void
  onClose: () => void
}

// ─── Global emoji stickers ────────────────────────────────────────────────────

const GLOBAL_STICKERS: Sticker[] = [
  { id: 'g1',  emoji: '👍', name: 'thumbsup',   category: 'Réactions' },
  { id: 'g2',  emoji: '👎', name: 'thumbsdown', category: 'Réactions' },
  { id: 'g3',  emoji: '❤️', name: 'heart',      category: 'Réactions' },
  { id: 'g4',  emoji: '😂', name: 'lol',        category: 'Réactions' },
  { id: 'g5',  emoji: '😮', name: 'wow',        category: 'Réactions' },
  { id: 'g6',  emoji: '😢', name: 'sad',        category: 'Réactions' },
  { id: 'g7',  emoji: '😡', name: 'angry',      category: 'Réactions' },
  { id: 'g8',  emoji: '🎉', name: 'party',      category: 'Réactions' },
  { id: 'g9',  emoji: '🔥', name: 'fire',       category: 'Réactions' },
  { id: 'g10', emoji: '💯', name: 'hundred',    category: 'Réactions' },
  { id: 'g11', emoji: '🐱', name: 'cat',        category: 'Animaux'   },
  { id: 'g12', emoji: '🐶', name: 'dog',        category: 'Animaux'   },
  { id: 'g13', emoji: '🐸', name: 'frog',       category: 'Animaux'   },
  { id: 'g14', emoji: '🦊', name: 'fox',        category: 'Animaux'   },
  { id: 'g15', emoji: '🐼', name: 'panda',      category: 'Animaux'   },
  { id: 'g16', emoji: '🦁', name: 'lion',       category: 'Animaux'   },
  { id: 'g17', emoji: '🐧', name: 'penguin',    category: 'Animaux'   },
  { id: 'g18', emoji: '🦋', name: 'butterfly',  category: 'Animaux'   },
  { id: 'g19', emoji: '🐙', name: 'octopus',    category: 'Animaux'   },
  { id: 'g20', emoji: '🦄', name: 'unicorn',    category: 'Animaux'   },
]

const GLOBAL_CATEGORIES = [...new Set(GLOBAL_STICKERS.map(s => s.category))]

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatStickerMessage(sticker: Sticker): string {
  if (sticker.url) {
    // Image sticker: [sticker:name](url)
    return `[sticker:${sticker.name}](${sticker.url})`
  }
  // Emoji sticker: [sticker:emoji:name]
  return `[sticker:${sticker.emoji ?? ''}:${sticker.name}]`
}

export function parseStickerMessage(content: string): { name: string; url?: string; emoji?: string } | null {
  const imgMatch = content.match(/^\[sticker:([^\]]+)\]\(([^)]+)\)$/)
  if (imgMatch) return { name: imgMatch[1], url: imgMatch[2] }
  const emojiMatch = content.match(/^\[sticker:(.+?):(.+?)\]$/)
  if (emojiMatch) return { emoji: emojiMatch[1], name: emojiMatch[2] }
  return null
}

// ─── Upload panel ─────────────────────────────────────────────────────────────

function UploadPanel({ serverId, onDone }: { serverId: string; onDone: () => void }) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)

  const upload = useMutation({
    mutationFn: () => {
      if (!file || !name.trim()) throw new Error('Champs requis')
      const fd = new FormData()
      fd.append('name', name.trim())
      fd.append('file', file)
      return api.post(`/servers/${serverId}/stickers`, fd)
    },
    onSuccess: () => {
      toast.success('Sticker ajouté')
      qc.invalidateQueries({ queryKey: ['server_stickers', serverId] })
      setName(''); setFile(null); onDone()
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur upload'),
  })

  return (
    <div className="p-3 border-t border-fc-hover space-y-2">
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Nom du sticker"
        maxLength={50}
        className="w-full fc-input text-xs"
      />
      <div
        onClick={() => fileRef.current?.click()}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-fc-hover
          text-fc-muted text-xs cursor-pointer hover:border-fc-accent hover:text-fc-accent transition"
      >
        <Upload size={13} />
        <span className="truncate">{file ? file.name : 'PNG / WEBP / GIF — max 512KB'}</span>
        {file && (
          <button
            onClick={e => { e.stopPropagation(); setFile(null) }}
            className="ml-auto text-fc-muted hover:text-white"
          >
            <X size={11} />
          </button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/webp,image/gif"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = '' }}
      />
      <button
        onClick={() => upload.mutate()}
        disabled={upload.isPending || !name.trim() || !file}
        className="w-full btn-primary text-xs disabled:opacity-40 flex items-center justify-center gap-1"
      >
        {upload.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
        {upload.isPending ? 'Upload...' : 'Uploader'}
      </button>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function StickerPicker({ serverId, onPick, onClose }: Props) {
  const [tab, setTab] = useState<'server' | 'global'>(serverId ? 'server' : 'global')
  const [globalCat, setGlobalCat] = useState(GLOBAL_CATEGORIES[0])
  const [hovered, setHovered] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)

  const { data: serverStickers = [], isLoading } = useQuery<ServerSticker[]>({
    queryKey: ['server_stickers', serverId],
    queryFn: () => api.get(`/servers/${serverId}/stickers`).then(r => r.data),
    enabled: !!serverId && tab === 'server',
    staleTime: 30_000,
  })

  const pick = (sticker: Sticker) => { onPick(sticker); onClose() }

  return (
    <div
      className="absolute bottom-full right-0 mb-2 bg-fc-channel border border-fc-hover
        rounded-xl shadow-2xl w-72 z-50 overflow-hidden"
      onClick={e => e.stopPropagation()}
    >
      {/* Tabs */}
      <div className="flex border-b border-fc-hover">
        {serverId && (
          <button
            onClick={() => setTab('server')}
            className={`flex-1 py-2 text-xs font-semibold transition
              ${tab === 'server' ? 'text-white border-b-2 border-fc-accent' : 'text-fc-muted hover:text-white'}`}
          >
            Serveur
          </button>
        )}
        <button
          onClick={() => setTab('global')}
          className={`flex-1 py-2 text-xs font-semibold transition
            ${tab === 'global' ? 'text-white border-b-2 border-fc-accent' : 'text-fc-muted hover:text-white'}`}
        >
          Global
        </button>
      </div>

      {/* ── Server tab ── */}
      {tab === 'server' && serverId && (
        <>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={18} className="animate-spin text-fc-muted" />
            </div>
          ) : serverStickers.length === 0 ? (
            <div className="py-6 text-center text-xs text-fc-muted px-4">
              Aucun sticker — les admins peuvent en ajouter via le bouton ci-dessous.
            </div>
          ) : (
            <div className="p-2 grid grid-cols-4 gap-1.5 max-h-52 overflow-y-auto">
              {serverStickers.map(ss => (
                <div key={ss.id} className="relative">
                  <button
                    onClick={() => pick({ id: ss.id, name: ss.name, url: ss.url, category: 'server' })}
                    onMouseEnter={() => setHovered(ss.id)}
                    onMouseLeave={() => setHovered(null)}
                    title={ss.name}
                    className="w-14 h-14 rounded-xl border border-fc-hover bg-fc-bg overflow-hidden
                      hover:border-fc-accent hover:scale-105 active:scale-95 transition-transform"
                  >
                    <img src={ss.url} alt={ss.name} className="w-full h-full object-contain" loading="lazy" />
                  </button>
                  {hovered === ss.id && (
                    <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-fc-bg border border-fc-hover
                      rounded px-2 py-0.5 text-xs text-white whitespace-nowrap pointer-events-none z-10 shadow">
                      {ss.name}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-fc-hover px-2 py-1.5 flex items-center gap-2">
            <button
              onClick={() => setShowUpload(p => !p)}
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition
                ${showUpload ? 'text-fc-accent bg-fc-accent/10' : 'text-fc-muted hover:text-white hover:bg-fc-hover'}`}
              title="Ajouter un sticker (admin/owner)"
            >
              <Upload size={12} />
              <span>Ajouter</span>
            </button>
            <span className="text-xs text-fc-muted ml-auto">{serverStickers.length}/60</span>
          </div>

          {showUpload && <UploadPanel serverId={serverId} onDone={() => setShowUpload(false)} />}
        </>
      )}

      {/* ── Global tab ── */}
      {tab === 'global' && (
        <>
          <div className="flex border-b border-fc-hover overflow-x-auto">
            {GLOBAL_CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setGlobalCat(cat)}
                className={`flex-shrink-0 px-3 py-1.5 text-xs font-medium transition
                  ${globalCat === cat ? 'text-white border-b-2 border-fc-accent' : 'text-fc-muted hover:text-white'}`}
              >
                {cat}
              </button>
            ))}
          </div>
          <div className="p-2 grid grid-cols-5 gap-2 max-h-52 overflow-y-auto">
            {GLOBAL_STICKERS.filter(s => s.category === globalCat).map(sticker => (
              <button
                key={sticker.id}
                onClick={() => pick(sticker)}
                title={sticker.name}
                className="flex items-center justify-center w-12 h-12 rounded-xl border border-fc-hover
                  bg-gradient-to-br from-fc-hover/40 to-fc-hover/20
                  hover:scale-110 active:scale-95 transition-transform cursor-pointer"
              >
                <span style={{ fontSize: '1.75rem', lineHeight: 1 }}>{sticker.emoji}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
