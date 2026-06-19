import { useState } from 'react'

export interface Sticker {
  id: string
  emoji: string
  name: string
  category: string
}

const STICKERS: Sticker[] = [
  // Réactions
  { id: 's1',  emoji: '👍', name: 'thumbsup',  category: 'Réactions' },
  { id: 's2',  emoji: '👎', name: 'thumbsdown', category: 'Réactions' },
  { id: 's3',  emoji: '❤️', name: 'heart',      category: 'Réactions' },
  { id: 's4',  emoji: '😂', name: 'lol',        category: 'Réactions' },
  { id: 's5',  emoji: '😮', name: 'wow',        category: 'Réactions' },
  { id: 's6',  emoji: '😢', name: 'sad',        category: 'Réactions' },
  { id: 's7',  emoji: '😡', name: 'angry',      category: 'Réactions' },
  { id: 's8',  emoji: '🎉', name: 'party',      category: 'Réactions' },
  { id: 's9',  emoji: '🔥', name: 'fire',       category: 'Réactions' },
  { id: 's10', emoji: '💯', name: 'hundred',    category: 'Réactions' },
  // Animaux
  { id: 's11', emoji: '🐱', name: 'cat',        category: 'Animaux' },
  { id: 's12', emoji: '🐶', name: 'dog',        category: 'Animaux' },
  { id: 's13', emoji: '🐸', name: 'frog',       category: 'Animaux' },
  { id: 's14', emoji: '🦊', name: 'fox',        category: 'Animaux' },
  { id: 's15', emoji: '🐼', name: 'panda',      category: 'Animaux' },
  { id: 's16', emoji: '🦁', name: 'lion',       category: 'Animaux' },
  { id: 's17', emoji: '🐧', name: 'penguin',    category: 'Animaux' },
  { id: 's18', emoji: '🦋', name: 'butterfly',  category: 'Animaux' },
  { id: 's19', emoji: '🐙', name: 'octopus',    category: 'Animaux' },
  { id: 's20', emoji: '🦄', name: 'unicorn',    category: 'Animaux' },
]

const CATEGORIES = [...new Set(STICKERS.map(s => s.category))]

const CATEGORY_COLORS: Record<string, string> = {
  'Réactions': 'from-indigo-500/20 to-purple-500/20 border-indigo-500/30',
  'Animaux':   'from-emerald-500/20 to-teal-500/20 border-emerald-500/30',
}

interface Props {
  onPick: (sticker: Sticker) => void
  onClose: () => void
}

export default function StickerPicker({ onPick, onClose }: Props) {
  const [activeCategory, setActiveCategory] = useState(CATEGORIES[0])

  const filtered = STICKERS.filter(s => s.category === activeCategory)

  return (
    <div
      className="absolute bottom-full right-0 mb-2 bg-fc-channel border border-fc-hover rounded-xl shadow-2xl w-72 z-50 overflow-hidden"
      onClick={e => e.stopPropagation()}
    >
      {/* Onglets catégories */}
      <div className="flex border-b border-fc-hover">
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`flex-1 py-2 text-xs font-semibold transition
              ${activeCategory === cat ? 'text-white border-b-2 border-fc-accent' : 'text-fc-muted hover:text-white'}`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Grille stickers */}
      <div className="p-2 grid grid-cols-5 gap-2">
        {filtered.map(sticker => {
          const colorClass = CATEGORY_COLORS[sticker.category] ?? 'from-fc-hover/40 to-fc-hover/20 border-fc-hover'
          return (
            <button
              key={sticker.id}
              onClick={() => { onPick(sticker); onClose() }}
              title={sticker.name}
              className={`flex items-center justify-center w-12 h-12 rounded-xl border bg-gradient-to-br ${colorClass}
                hover:scale-110 active:scale-95 transition-transform cursor-pointer`}
            >
              <span style={{ fontSize: '2rem', lineHeight: 1 }}>{sticker.emoji}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Format sticker pour encodage dans le contenu message
export function formatStickerMessage(sticker: Sticker): string {
  return `[sticker:${sticker.emoji}:${sticker.name}]`
}

// Détecte si un message est un sticker pur
export function parseStickerMessage(content: string): { emoji: string; name: string } | null {
  const match = content.match(/^\[sticker:(.+?):(.+?)\]$/)
  if (!match) return null
  return { emoji: match[1], name: match[2] }
}
