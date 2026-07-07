import { useState, useRef } from 'react'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import PickerShell from '../ui/PickerShell'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, X, Loader2 } from 'lucide-react'
import api from '../../api/client'
import toast from 'react-hot-toast'

// ─── Types ────────────────────────────────────────────────────────────────────

export type { Sticker } from './sticker-utils'
export { formatStickerMessage, parseStickerMessage } from './sticker-utils'
import type { Sticker } from './sticker-utils'

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
        enterKeyHint="done"
        autoCapitalize="none"
        aria-label="Nom du sticker"
        className="w-full fc-input text-xs"
      />
      <div
        role="button"
        tabIndex={0}
        aria-label={file ? `Fichier sélectionné : ${file.name}` : 'Sélectionner un fichier image (PNG, WEBP ou GIF, max 512 Ko)'}
        onClick={() => fileRef.current?.click()}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click() }}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-fc-hover
          text-fc-muted text-xs cursor-pointer hover:border-fc-accent hover:text-fc-accent transition"
      >
        <Upload size={13} aria-hidden />
        <span className="truncate" aria-hidden>{file ? file.name : 'PNG / WEBP / GIF — max 512KB'}</span>
        {file && (
          <button
            onClick={e => { e.stopPropagation(); setFile(null) }}
            aria-label="Retirer le fichier sélectionné"
            className="ml-auto text-fc-muted hover:text-white"
          >
            <X size={11} aria-hidden />
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
        aria-busy={upload.isPending}
        className="w-full btn-primary text-xs disabled:opacity-40 flex items-center justify-center gap-1"
      >
        {upload.isPending ? <Loader2 size={12} aria-hidden className="animate-spin" /> : null}
        {upload.isPending ? 'Upload...' : 'Uploader'}
      </button>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function StickerPicker({ serverId, onPick, onClose }: Props) {
  useEscapeKey(onClose)
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
    <PickerShell
      onClose={onClose}
      desktopClassName="absolute bottom-full right-0 mb-2 bg-fc-channel border border-fc-hover rounded-xl shadow-2xl w-72 z-50 overflow-hidden"
    >
      {/* Tabs */}
      <div role="tablist" aria-label="Type de stickers" className="flex border-b border-fc-hover">
        {serverId && (
          <button
            role="tab"
            aria-selected={tab === 'server'}
            onClick={() => setTab('server')}
            className={`flex-1 py-2 text-xs font-semibold transition
              ${tab === 'server' ? 'text-white border-b-2 border-fc-accent' : 'text-fc-muted hover:text-white'}`}
          >
            Serveur
          </button>
        )}
        <button
          role="tab"
          aria-selected={tab === 'global'}
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
            <div role="status" aria-label="Chargement des stickers" className="flex items-center justify-center py-8">
              <Loader2 size={18} aria-hidden className="animate-spin text-fc-muted" />
            </div>
          ) : serverStickers.length === 0 ? (
            <div role="status" className="py-6 text-center text-xs text-fc-muted px-4">
              Aucun sticker — les admins peuvent en ajouter via le bouton ci-dessous.
            </div>
          ) : (
            <div className="p-2 grid grid-cols-4 gap-1.5 max-h-52 overflow-y-auto overscroll-contain">
              {serverStickers.map(ss => (
                <div key={ss.id} className="relative">
                  <button
                    onClick={() => pick({ id: ss.id, name: ss.name, url: ss.url, category: 'server' })}
                    onMouseEnter={() => setHovered(ss.id)}
                    onMouseLeave={() => setHovered(null)}
                    aria-label={ss.name}
                    className="w-14 h-14 rounded-xl border border-fc-hover bg-fc-bg overflow-hidden
                      hover:border-fc-accent hover:scale-105 active:scale-95 transition-transform"
                  >
                    <img src={ss.url} alt={ss.name} className="w-full h-full object-contain" loading="lazy" />
                  </button>
                  {hovered === ss.id && (
                    <div aria-hidden className="absolute -top-7 left-1/2 -translate-x-1/2 bg-fc-bg border border-fc-hover
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
              aria-expanded={showUpload}
              aria-label="Ajouter un sticker (admin/owner)"
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition
                ${showUpload ? 'text-fc-accent bg-fc-accent/10' : 'text-fc-muted hover:text-white hover:bg-fc-hover'}`}
            >
              <Upload size={12} aria-hidden />
              <span aria-hidden>Ajouter</span>
            </button>
            <span className="text-xs text-fc-muted ml-auto" aria-hidden>{serverStickers.length}/60</span>
          </div>

          {showUpload && <UploadPanel serverId={serverId} onDone={() => setShowUpload(false)} />}
        </>
      )}

      {/* ── Global tab ── */}
      {tab === 'global' && (
        <>
          <div role="tablist" aria-label="Catégorie de stickers" className="flex border-b border-fc-hover overflow-x-auto">
            {GLOBAL_CATEGORIES.map(cat => (
              <button
                key={cat}
                role="tab"
                aria-selected={globalCat === cat}
                onClick={() => setGlobalCat(cat)}
                className={`flex-shrink-0 px-3 py-1.5 text-xs font-medium transition
                  ${globalCat === cat ? 'text-white border-b-2 border-fc-accent' : 'text-fc-muted hover:text-white'}`}
              >
                {cat}
              </button>
            ))}
          </div>
          <div className="p-2 grid grid-cols-5 gap-2 max-h-52 overflow-y-auto overscroll-contain">
            {GLOBAL_STICKERS.filter(s => s.category === globalCat).map(sticker => (
              <button
                key={sticker.id}
                onClick={() => pick(sticker)}
                aria-label={sticker.name}
                className="flex items-center justify-center w-12 h-12 rounded-xl border border-fc-hover
                  bg-gradient-to-br from-fc-hover/40 to-fc-hover/20
                  hover:scale-110 active:scale-95 transition-transform cursor-pointer"
              >
                <span aria-hidden style={{ fontSize: '1.75rem', lineHeight: 1 }}>{sticker.emoji}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </PickerShell>
  )
}
