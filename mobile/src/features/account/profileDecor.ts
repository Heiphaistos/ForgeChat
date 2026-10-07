/**
 * Personnalisation du profil (gratuite) : mêmes identifiants que la liste blanche
 * du serveur (server/src/models/user.rs) et que le web (components/ui/ProfileDecor.tsx).
 */
import type { Key } from '@/i18n'

export interface Decoration {
  id: string
  /** Clé du libellé (traduit au rendu). */
  label: Key
  /** Couleurs réparties sur les 4 côtés de l'anneau (pas de dégradé natif sans dépendance). */
  colors: string[]
  kind: 'ring' | 'dashed' | 'double'
  anim?: 'spin' | 'pulse'
}

export const DECORATIONS: Decoration[] = [
  { id: 'gold', label: 'settings.decor.gold', colors: ['#f7d774', '#b8860b', '#fff1b8', '#b8860b'], kind: 'ring' },
  { id: 'silver', label: 'settings.decor.silver', colors: ['#f4f6f8', '#8e9aa6', '#ffffff', '#8e9aa6'], kind: 'ring' },
  { id: 'neon', label: 'settings.decor.neon', colors: ['#00f0ff', '#ff00e5'], kind: 'ring', anim: 'spin' },
  { id: 'rainbow', label: 'settings.decor.rainbow', colors: ['#ff3b30', '#ffcc00', '#34c759', '#007aff'], kind: 'ring', anim: 'spin' },
  { id: 'fire', label: 'settings.decor.fire', colors: ['#ff3d00', '#ffb300', '#ff6d00'], kind: 'ring', anim: 'pulse' },
  { id: 'ice', label: 'settings.decor.ice', colors: ['#a8e6ff', '#ffffff', '#5ac8fa'], kind: 'ring' },
  { id: 'emerald', label: 'settings.decor.emerald', colors: ['#2ecc71', '#0b6623', '#7dffb0'], kind: 'ring' },
  { id: 'sakura', label: 'settings.decor.sakura', colors: ['#ffb7c5', '#ff6f91'], kind: 'ring', anim: 'pulse' },
  { id: 'void', label: 'settings.decor.void', colors: ['#6a00ff', '#120024', '#b388ff'], kind: 'ring', anim: 'spin' },
  { id: 'sunset', label: 'settings.decor.sunset', colors: ['#ff7e5f', '#feb47b', '#c471ed'], kind: 'ring' },
  { id: 'ocean', label: 'settings.decor.ocean', colors: ['#00c6ff', '#0072ff'], kind: 'ring', anim: 'spin' },
  { id: 'dashed', label: 'settings.decor.dashed', colors: ['#5ee7df'], kind: 'dashed', anim: 'spin' },
  { id: 'double', label: 'settings.decor.double', colors: ['#b388ff'], kind: 'double' },
  { id: 'glow', label: 'settings.decor.glow', colors: ['#ffffff'], kind: 'ring', anim: 'pulse' },
]

export const PROFILE_EFFECTS: { id: string; label: Key; char: string; color: string; rise: boolean }[] = [
  { id: 'sparkles', label: 'settings.decor.sparkles', char: '✦', color: '#ffe680', rise: true },
  { id: 'snow', label: 'settings.decor.snow', char: '❄', color: '#e6f4ff', rise: false },
  { id: 'hearts', label: 'settings.decor.hearts', char: '♥', color: '#ff5c8a', rise: true },
  { id: 'stars', label: 'settings.decor.stars', char: '★', color: '#ffd166', rise: false },
  { id: 'bubbles', label: 'settings.decor.bubbles', char: '○', color: '#9be7ff', rise: true },
]

export const findDecoration = (id: string | null | undefined) => DECORATIONS.find((d) => d.id === id)

/** Entier 0xRRGGBB → « #rrggbb ». */
export const hexColor = (c: number) => `#${c.toString(16).padStart(6, '0')}`

/** Nuancier du thème de profil (pas de sélecteur de couleur natif sans dépendance). */
export const THEME_SWATCHES = [
  0x5865f2, 0x9b59b6, 0xeb459e, 0xed4245, 0xff7e5f, 0xfaa61a,
  0xf1c40f, 0x3ba55c, 0x1abc9c, 0x00c6ff, 0x2c3e50, 0x111214,
]

/** Couleurs du thème (haut/bas de la fiche) ; null = thème par défaut. */
export function profileTheme(primary?: number | null, accent?: number | null): { top: string; bottom: string } | null {
  if (primary == null && accent == null) return null
  return { top: hexColor(primary ?? accent!), bottom: hexColor(accent ?? primary!) }
}
