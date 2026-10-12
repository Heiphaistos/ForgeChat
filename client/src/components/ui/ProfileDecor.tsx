import { useMemo, type CSSProperties, type ReactNode } from 'react'
import type { Key } from '../../i18n'

/**
 * Personnalisation du profil (gratuite) : décoration d'avatar, thème de la fiche
 * et effet à l'ouverture. Identifiants identiques à la liste blanche du serveur
 * (server/src/models/user.rs) et au mobile (mobile/src/features/account/profileDecor.ts).
 * Tout est dessiné en CSS (dégradés, masques, glyphes) : aucune image ni requête réseau.
 * Les couleurs sont des constantes de ce fichier, jamais une valeur venue d'un utilisateur.
 */

/** Forme de l'anneau. */
type DecoKind =
  | 'ring'      // dégradé conique plein
  | 'dashed'    // bordure en tirets
  | 'double'    // bordure double
  | 'stripes'   // rayures (sucre d'orge, danger)
  | 'segments'  // segments séparés (pixel, arcade)
  | 'dual'      // anneau + fin liseré extérieur
/** Animation de l'anneau (profileStyles.css, coupée si « réduire les animations »). */
type DecoAnim = 'spin' | 'spinrev' | 'pulse' | 'hue' | 'flicker' | 'flash' | 'steps' | 'breathe'

export type Deco = {
  id: string
  label: Key
  colors: string[]
  kind: DecoKind
  anim?: DecoAnim
  /** Halo coloré autour de l'anneau. */
  glow?: string
  /** Ornement répété autour de l'avatar (4 glyphes), scintillant. */
  glyph?: string
  /** Particule qui tourne autour de l'avatar. */
  orbit?: string
  /** Épaisseur relative (1 = défaut). */
  thick?: number
}

/** Catégories du sélecteur (dans l'ordre d'affichage). */
export const DECO_GROUPS: { id: string; label: Key; ids: string[] }[] = [
  { id: 'classic', label: 'pstyle.decoGroup.classic', ids: ['gold', 'silver', 'neon', 'rainbow', 'fire', 'ice', 'emerald', 'sakura', 'void', 'sunset', 'ocean', 'dashed', 'double', 'glow'] },
  { id: 'holo', label: 'pstyle.decoGroup.holo', ids: ['holo', 'iridescent', 'prism', 'opal', 'pearl', 'aurora', 'chroma', 'mirage'] },
  { id: 'elements', label: 'pstyle.decoGroup.elements', ids: ['inferno', 'ember', 'frost', 'glacier', 'lightning', 'storm', 'tide', 'magma', 'terra', 'zephyr', 'toxic', 'plasma'] },
  { id: 'neon', label: 'pstyle.decoGroup.neon', ids: ['neon_pink', 'neon_cyan', 'neon_lime', 'synthwave', 'cyberpunk', 'laser'] },
  { id: 'pixel', label: 'pstyle.decoGroup.pixel', ids: ['pixel', 'pixel_rainbow', 'arcade'] },
  { id: 'seasons', label: 'pstyle.decoGroup.seasons', ids: ['halloween', 'christmas', 'winter', 'spring', 'summer', 'autumn', 'valentine', 'easter', 'newyear', 'lunar'] },
  { id: 'cosmos', label: 'pstyle.decoGroup.cosmos', ids: ['galaxy', 'nebula', 'starry', 'moonlit', 'solar', 'orbit', 'comet'] },
  { id: 'gems', label: 'pstyle.decoGroup.gems', ids: ['royal', 'diamond', 'ruby', 'sapphire', 'amethyst'] },
]

const RAINBOW = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#af52de']
const HOLO = ['#ff9ff3', '#a0e7ff', '#c4ffb5', '#fff3a0', '#d0a8ff']

export const DECORATIONS: Deco[] = [
  { id: 'gold', label: 'profile.deco.gold', colors: ['#f7d774', '#b8860b', '#fff1b8', '#b8860b'], kind: 'ring' },
  { id: 'silver', label: 'profile.deco.silver', colors: ['#f4f6f8', '#8e9aa6', '#ffffff', '#8e9aa6'], kind: 'ring' },
  { id: 'neon', label: 'profile.deco.neon', colors: ['#00f0ff', '#ff00e5'], kind: 'ring', anim: 'spin', glow: '#00f0ff' },
  { id: 'rainbow', label: 'profile.deco.rainbow', colors: RAINBOW, kind: 'ring', anim: 'spin' },
  { id: 'fire', label: 'profile.deco.fire', colors: ['#ff3d00', '#ffb300', '#ff6d00'], kind: 'ring', anim: 'pulse', glow: '#ff3d00' },
  { id: 'ice', label: 'profile.deco.ice', colors: ['#a8e6ff', '#ffffff', '#5ac8fa'], kind: 'ring' },
  { id: 'emerald', label: 'profile.deco.emerald', colors: ['#2ecc71', '#0b6623', '#7dffb0'], kind: 'ring' },
  { id: 'sakura', label: 'profile.deco.sakura', colors: ['#ffb7c5', '#ff6f91'], kind: 'ring', anim: 'pulse' },
  { id: 'void', label: 'profile.deco.void', colors: ['#6a00ff', '#120024', '#b388ff'], kind: 'ring', anim: 'spin' },
  { id: 'sunset', label: 'profile.deco.sunset', colors: ['#ff7e5f', '#feb47b', '#c471ed'], kind: 'ring' },
  { id: 'ocean', label: 'profile.deco.ocean', colors: ['#00c6ff', '#0072ff'], kind: 'ring', anim: 'spin' },
  { id: 'dashed', label: 'profile.deco.dashed', colors: ['#5ee7df'], kind: 'dashed', anim: 'spin' },
  { id: 'double', label: 'profile.deco.double', colors: ['#b388ff'], kind: 'double' },
  { id: 'glow', label: 'profile.deco.glow', colors: ['#ffffff'], kind: 'ring', anim: 'pulse', glow: '#ffffff' },
  // Holographiques / irisées : teinte qui tourne (hue-rotate) sur des pastels.
  { id: 'holo', label: 'pstyle.deco.holo', colors: HOLO, kind: 'ring', anim: 'hue', glow: '#d0a8ff' },
  { id: 'iridescent', label: 'pstyle.deco.iridescent', colors: ['#7afcff', '#feff9c', '#ff7eb9', '#a0a4ff'], kind: 'ring', anim: 'hue' },
  { id: 'prism', label: 'pstyle.deco.prism', colors: RAINBOW, kind: 'segments', anim: 'hue', glyph: '◆' },
  { id: 'opal', label: 'pstyle.deco.opal', colors: ['#e0f7fa', '#f8bbd0', '#b2ebf2', '#fff9c4', '#d1c4e9'], kind: 'ring', anim: 'breathe' },
  { id: 'pearl', label: 'pstyle.deco.pearl', colors: ['#fdfcfb', '#e2d1c3', '#ffffff', '#d7e1ec'], kind: 'dual', glow: '#ffffff' },
  { id: 'aurora', label: 'pstyle.deco.aurora', colors: ['#00ffa3', '#00b4ff', '#8a2be2', '#00ffa3'], kind: 'ring', anim: 'hue', glow: '#00ffa3' },
  { id: 'chroma', label: 'pstyle.deco.chroma', colors: ['#ff0080', '#7928ca', '#0070f3', '#00dfd8'], kind: 'ring', anim: 'spin', glow: '#7928ca' },
  { id: 'mirage', label: 'pstyle.deco.mirage', colors: ['#fbc2eb', '#a6c1ee', '#fbc2eb'], kind: 'dual', anim: 'breathe' },
  // Éléments
  { id: 'inferno', label: 'pstyle.deco.inferno', colors: ['#ff1e00', '#ff8a00', '#ffd000', '#ff1e00'], kind: 'ring', anim: 'flicker', glow: '#ff5a00', glyph: '▲', thick: 1.3 },
  { id: 'ember', label: 'pstyle.deco.ember', colors: ['#7a1500', '#ff5a1f', '#ffb347'], kind: 'ring', anim: 'breathe', orbit: '•' },
  { id: 'frost', label: 'pstyle.deco.frost', colors: ['#e0f7ff', '#8fd3ff', '#ffffff'], kind: 'ring', glyph: '❄', glow: '#bdeeff' },
  { id: 'glacier', label: 'pstyle.deco.glacier', colors: ['#3a7bd5', '#00d2ff', '#e0f7ff'], kind: 'segments', anim: 'spinrev' },
  { id: 'lightning', label: 'pstyle.deco.lightning', colors: ['#fff700', '#ffffff', '#7df9ff'], kind: 'dashed', anim: 'flash', glow: '#fff700', glyph: '⚡' },
  { id: 'storm', label: 'pstyle.deco.storm', colors: ['#2c3e50', '#7df9ff', '#4b6cb7'], kind: 'ring', anim: 'flash', glow: '#7df9ff' },
  { id: 'tide', label: 'pstyle.deco.tide', colors: ['#004e92', '#00c9ff', '#92fe9d', '#004e92'], kind: 'ring', anim: 'spin' },
  { id: 'magma', label: 'pstyle.deco.magma', colors: ['#200122', '#ff3c00', '#6f0000'], kind: 'ring', anim: 'breathe', glow: '#ff3c00' },
  { id: 'terra', label: 'pstyle.deco.terra', colors: ['#5d4037', '#8bc34a', '#a1887f', '#33691e'], kind: 'segments', glyph: '❦' },
  { id: 'zephyr', label: 'pstyle.deco.zephyr', colors: ['#e0ffff', '#a8edea', '#fed6e3'], kind: 'dashed', anim: 'spin' },
  { id: 'toxic', label: 'pstyle.deco.toxic', colors: ['#39ff14', '#0b3d02', '#c6ff00'], kind: 'stripes', anim: 'spin', glow: '#39ff14' },
  { id: 'plasma', label: 'pstyle.deco.plasma', colors: ['#f72585', '#7209b7', '#4cc9f0', '#f72585'], kind: 'ring', anim: 'spin', glow: '#f72585', orbit: '●' },
  // Néon
  { id: 'neon_pink', label: 'pstyle.deco.neon_pink', colors: ['#ff2bd6'], kind: 'dual', anim: 'flicker', glow: '#ff2bd6' },
  { id: 'neon_cyan', label: 'pstyle.deco.neon_cyan', colors: ['#00f0ff'], kind: 'dual', anim: 'flicker', glow: '#00f0ff' },
  { id: 'neon_lime', label: 'pstyle.deco.neon_lime', colors: ['#b6ff00'], kind: 'dual', anim: 'flicker', glow: '#b6ff00' },
  { id: 'synthwave', label: 'pstyle.deco.synthwave', colors: ['#ff2bd6', '#ff9a00', '#00e5ff', '#ff2bd6'], kind: 'ring', anim: 'spin', glow: '#ff2bd6' },
  { id: 'cyberpunk', label: 'pstyle.deco.cyberpunk', colors: ['#fcee0a', '#00f0ff'], kind: 'stripes', anim: 'steps', glow: '#fcee0a' },
  { id: 'laser', label: 'pstyle.deco.laser', colors: ['#ff0040', '#ff0040', 'transparent', '#00ff9f', '#00ff9f', 'transparent'], kind: 'ring', anim: 'spin', glow: '#ff0040' },
  // Pixel : segments à pas fixes, rotation saccadée.
  { id: 'pixel', label: 'pstyle.deco.pixel', colors: ['#5b6ee1', '#99e550', '#fbf236', '#d95763'], kind: 'segments', anim: 'steps', thick: 1.3 },
  { id: 'pixel_rainbow', label: 'pstyle.deco.pixel_rainbow', colors: RAINBOW, kind: 'segments', anim: 'steps', thick: 1.3 },
  { id: 'arcade', label: 'pstyle.deco.arcade', colors: ['#ffcc00', '#000000'], kind: 'segments', anim: 'steps', glyph: '■' },
  // Saisons et fêtes
  { id: 'halloween', label: 'pstyle.deco.halloween', colors: ['#ff7518', '#2b0a3d'], kind: 'stripes', glyph: '☾', glow: '#ff7518' },
  { id: 'christmas', label: 'pstyle.deco.christmas', colors: ['#d42426', '#ffffff'], kind: 'stripes', anim: 'spin', glyph: '★' },
  { id: 'winter', label: 'pstyle.deco.winter', colors: ['#dff6ff', '#9bd4ff', '#ffffff'], kind: 'ring', glyph: '❅', anim: 'breathe' },
  { id: 'spring', label: 'pstyle.deco.spring', colors: ['#b8f2a6', '#ffd1dc', '#fff6a6'], kind: 'ring', glyph: '✿' },
  { id: 'summer', label: 'pstyle.deco.summer', colors: ['#ffd200', '#f7971e', '#00c6ff'], kind: 'ring', glyph: '☀', anim: 'spin' },
  { id: 'autumn', label: 'pstyle.deco.autumn', colors: ['#d35400', '#f39c12', '#8e2b0b', '#e67e22'], kind: 'ring', glyph: '❦' },
  { id: 'valentine', label: 'pstyle.deco.valentine', colors: ['#ff4d6d', '#ffb3c1', '#c9184a'], kind: 'ring', glyph: '♥', anim: 'pulse', glow: '#ff4d6d' },
  { id: 'easter', label: 'pstyle.deco.easter', colors: ['#ffd6e0', '#c1f0c1', '#fff5ba', '#c5d7ff'], kind: 'stripes', glyph: '✿' },
  { id: 'newyear', label: 'pstyle.deco.newyear', colors: ['#ffd700', '#1a1a2e', '#ffd700', '#c0c0c0'], kind: 'ring', glyph: '✦', anim: 'spin', glow: '#ffd700' },
  { id: 'lunar', label: 'pstyle.deco.lunar', colors: ['#c1121f', '#ffd166'], kind: 'dual', glyph: '✺', glow: '#ffd166' },
  // Cosmos
  { id: 'galaxy', label: 'pstyle.deco.galaxy', colors: ['#0f0c29', '#6a3093', '#a044ff', '#24243e'], kind: 'ring', anim: 'spin', glyph: '✧', glow: '#a044ff' },
  { id: 'nebula', label: 'pstyle.deco.nebula', colors: ['#ff6ec4', '#7873f5', '#4adede', '#ff6ec4'], kind: 'ring', anim: 'hue', glow: '#7873f5' },
  { id: 'starry', label: 'pstyle.deco.starry', colors: ['#141e30', '#243b55', '#ffd166'], kind: 'ring', glyph: '★' },
  { id: 'moonlit', label: 'pstyle.deco.moonlit', colors: ['#cfd9df', '#2c3e50', '#e2ebf0'], kind: 'dual', glyph: '☾', glow: '#cfd9df' },
  { id: 'solar', label: 'pstyle.deco.solar', colors: ['#ffef00', '#ff8c00', '#ff4500', '#ffef00'], kind: 'ring', anim: 'spin', glow: '#ff8c00', thick: 1.2 },
  { id: 'orbit', label: 'pstyle.deco.orbit', colors: ['#8e9aff'], kind: 'dashed', orbit: '●' },
  { id: 'comet', label: 'pstyle.deco.comet', colors: ['transparent', 'transparent', '#7df9ff', '#ffffff'], kind: 'ring', anim: 'spin', glow: '#7df9ff', orbit: '✦' },
  // Pierres précieuses
  { id: 'royal', label: 'pstyle.deco.royal', colors: ['#4b0082', '#ffd700', '#4b0082', '#ffd700'], kind: 'dual', glyph: '♛', glow: '#ffd700' },
  { id: 'diamond', label: 'pstyle.deco.diamond', colors: ['#ffffff', '#b9f2ff', '#e0e0e0', '#ffffff'], kind: 'segments', anim: 'hue', glyph: '◆', glow: '#b9f2ff' },
  { id: 'ruby', label: 'pstyle.deco.ruby', colors: ['#9b111e', '#e0115f', '#ff6f91'], kind: 'ring', glow: '#e0115f' },
  { id: 'sapphire', label: 'pstyle.deco.sapphire', colors: ['#0f52ba', '#6ca0dc', '#082567'], kind: 'ring', glow: '#0f52ba' },
  { id: 'amethyst', label: 'pstyle.deco.amethyst', colors: ['#9966cc', '#5d3a9b', '#d8bfd8'], kind: 'ring', glow: '#9966cc' },
]

/** Mouvement d'une particule d'effet (keyframes fc-fx-<motion> de index.css / profileStyles.css). */
type FxMotion = 'fall' | 'rise' | 'twinkle' | 'sway' | 'rain' | 'burst' | 'confetti' | 'drift' | 'diagonal'
/** Calque plein écran de l'effet (fc-fx-ov-<overlay>). */
type FxOverlay = 'aurora' | 'flash' | 'sunrays' | 'glitch' | 'rainbow' | 'mist' | 'synthwave' | 'plasma' | 'ocean' | 'nebula' | 'moon'

export type ProfileFx = {
  id: string
  label: Key
  /** Glyphes tirés au hasard pour chaque particule (aucun si effet de calque seul). */
  chars: string[]
  colors: string[]
  motion: FxMotion
  overlay?: FxOverlay
  /** Nombre de particules (14 par défaut). */
  count?: number
  /** Taille de base en px. */
  size?: number
}

export const PROFILE_EFFECTS: ProfileFx[] = [
  { id: 'sparkles', label: 'profile.effect.sparkles', chars: ['✦'], colors: ['#ffe680'], motion: 'twinkle' },
  { id: 'snow', label: 'profile.effect.snow', chars: ['❄'], colors: ['#e6f4ff'], motion: 'fall' },
  { id: 'hearts', label: 'profile.effect.hearts', chars: ['♥'], colors: ['#ff5c8a'], motion: 'rise' },
  { id: 'stars', label: 'profile.effect.stars', chars: ['★'], colors: ['#ffd166'], motion: 'fall' },
  { id: 'bubbles', label: 'profile.effect.bubbles', chars: ['○'], colors: ['#9be7ff'], motion: 'rise' },
  { id: 'rain', label: 'pstyle.fx.rain', chars: ['│'], colors: ['#8fc9ff', '#5aa9e6'], motion: 'rain', count: 30, size: 12 },
  { id: 'storm', label: 'pstyle.fx.storm', chars: ['│'], colors: ['#9fb8d6'], motion: 'rain', count: 34, size: 14, overlay: 'flash' },
  { id: 'sakura', label: 'pstyle.fx.sakura', chars: ['✿', '❀'], colors: ['#ffb7c5', '#ff8fab', '#ffe5ec'], motion: 'sway', count: 16 },
  { id: 'leaves', label: 'pstyle.fx.leaves', chars: ['❦', '❧'], colors: ['#d35400', '#f39c12', '#a04000', '#e67e22'], motion: 'sway', count: 14 },
  { id: 'confetti', label: 'pstyle.fx.confetti', chars: ['■', '▲', '●', '▬'], colors: RAINBOW, motion: 'confetti', count: 28, size: 9 },
  { id: 'fireworks', label: 'pstyle.fx.fireworks', chars: ['✸', '✺', '✦', '·'], colors: ['#ffd166', '#ff5c8a', '#5ee7df', '#b388ff', '#ffffff'], motion: 'burst', count: 26 },
  { id: 'embers', label: 'pstyle.fx.embers', chars: ['•', '●'], colors: ['#ff6d00', '#ffb300', '#ff3d00'], motion: 'rise', count: 22, size: 7 },
  { id: 'fire', label: 'pstyle.fx.fire', chars: ['●'], colors: ['#ff3d00', '#ff9100', '#ffd600'], motion: 'rise', count: 26, size: 16 },
  { id: 'aurora', label: 'pstyle.fx.aurora', chars: [], colors: [], motion: 'twinkle', overlay: 'aurora', count: 0 },
  { id: 'matrix', label: 'pstyle.fx.matrix', chars: ['ア', 'カ', 'サ', 'タ', 'ナ', 'ハ', 'マ', '0', '1', 'ﾘ', 'ﾂ'], colors: ['#00ff41', '#00c832', '#a6ffb0'], motion: 'rain', count: 34, size: 13 },
  { id: 'galaxy', label: 'pstyle.fx.galaxy', chars: ['✧', '✦', '⋆', '·'], colors: ['#ffffff', '#c3b1ff', '#8ec5ff'], motion: 'twinkle', overlay: 'nebula', count: 24 },
  { id: 'meteors', label: 'pstyle.fx.meteors', chars: ['☄', '✦'], colors: ['#ffffff', '#7df9ff', '#ffd166'], motion: 'diagonal', count: 10, size: 16 },
  { id: 'fireflies', label: 'pstyle.fx.fireflies', chars: ['●'], colors: ['#f9ff8a', '#d4ff4f'], motion: 'drift', count: 18, size: 6 },
  { id: 'notes', label: 'pstyle.fx.notes', chars: ['♪', '♫', '♬'], colors: ['#b388ff', '#5ee7df', '#ff8fab'], motion: 'rise', count: 14 },
  { id: 'coins', label: 'pstyle.fx.coins', chars: ['◉', '●'], colors: ['#ffd700', '#ffb300', '#fff1b8'], motion: 'fall', count: 18 },
  { id: 'gems', label: 'pstyle.fx.gems', chars: ['◆', '◇', '⬥'], colors: ['#e0115f', '#0f52ba', '#50c878', '#9966cc', '#b9f2ff'], motion: 'twinkle', count: 18 },
  { id: 'petals', label: 'pstyle.fx.petals', chars: ['❀', '❁'], colors: ['#ffffff', '#ffe4ef', '#fff6d6'], motion: 'sway', count: 14 },
  { id: 'lightning', label: 'pstyle.fx.lightning', chars: ['⚡'], colors: ['#fff700', '#7df9ff'], motion: 'twinkle', overlay: 'flash', count: 6, size: 22 },
  { id: 'sunrays', label: 'pstyle.fx.sunrays', chars: [], colors: [], motion: 'twinkle', overlay: 'sunrays', count: 0 },
  { id: 'moonlight', label: 'pstyle.fx.moonlight', chars: ['✧', '·', '☾'], colors: ['#e2ebf0', '#a8c0ff'], motion: 'twinkle', overlay: 'moon', count: 14 },
  { id: 'love', label: 'pstyle.fx.love', chars: ['♥', '❤'], colors: ['#ff4d6d', '#ff8fab', '#ffb3c1'], motion: 'burst', count: 22 },
  { id: 'soap', label: 'pstyle.fx.soap', chars: ['○', '◯'], colors: HOLO, motion: 'rise', count: 16, size: 18 },
  { id: 'blizzard', label: 'pstyle.fx.blizzard', chars: ['❄', '❅', '❆', '·'], colors: ['#ffffff', '#dff6ff'], motion: 'diagonal', count: 34, size: 11 },
  { id: 'pixels', label: 'pstyle.fx.pixels', chars: ['■'], colors: ['#5b6ee1', '#99e550', '#fbf236', '#d95763', '#ffffff'], motion: 'fall', count: 26, size: 8 },
  { id: 'glitch', label: 'pstyle.fx.glitch', chars: [], colors: [], motion: 'twinkle', overlay: 'glitch', count: 0 },
  { id: 'rainbow', label: 'pstyle.fx.rainbow', chars: [], colors: [], motion: 'twinkle', overlay: 'rainbow', count: 0 },
  { id: 'mist', label: 'pstyle.fx.mist', chars: [], colors: [], motion: 'twinkle', overlay: 'mist', count: 0 },
  { id: 'spooky', label: 'pstyle.fx.spooky', chars: ['☾', '✦', '✖', '⁂'], colors: ['#ff7518', '#9d4edd', '#c7f464'], motion: 'sway', count: 14 },
  { id: 'festive', label: 'pstyle.fx.festive', chars: ['❄', '★', '●'], colors: ['#d42426', '#2f9e44', '#ffd700', '#ffffff'], motion: 'fall', count: 22 },
  { id: 'synthwave', label: 'pstyle.fx.synthwave', chars: [], colors: [], motion: 'twinkle', overlay: 'synthwave', count: 0 },
  { id: 'stardust', label: 'pstyle.fx.stardust', chars: ['·', '•', '✦'], colors: ['#ffd700', '#fff1b8', '#ffe680'], motion: 'drift', count: 30, size: 8 },
  { id: 'plasma', label: 'pstyle.fx.plasma', chars: [], colors: [], motion: 'twinkle', overlay: 'plasma', count: 0 },
  { id: 'ocean', label: 'pstyle.fx.ocean', chars: ['○', '∘'], colors: ['#9be7ff', '#e0f7ff'], motion: 'rise', overlay: 'ocean', count: 12, size: 10 },
]

/** Entier 0xRRGGBB → « #rrggbb ». */
export const hexColor = (c: number) => `#${c.toString(16).padStart(6, '0')}`

/** Fond de la fiche selon le thème ; undefined = fond par défaut. */
export function profileThemeBackground(primary?: number | null, accent?: number | null): string | undefined {
  if (primary == null && accent == null) return undefined
  const a = hexColor(primary ?? accent!)
  const b = hexColor(accent ?? primary!)
  // Voile sombre par-dessus pour garder le texte lisible quelles que soient les couleurs.
  return `linear-gradient(rgba(0,0,0,.45), rgba(0,0,0,.45)), linear-gradient(160deg, ${a} 0%, ${b} 100%)`
}

/** Fond de l'anneau selon sa forme. */
function ringBackground(deco: Deco): string {
  const c = deco.colors
  if (deco.kind === 'stripes') {
    const step = 360 / 24
    return `repeating-conic-gradient(${c.map((col, i) => `${col} ${i * step}deg ${(i + 1) * step}deg`).join(', ')} ${c.length * step}deg)`
  }
  if (deco.kind === 'segments') {
    // 12 segments séparés par un petit vide, couleurs en boucle.
    const seg = 30
    const stops: string[] = []
    for (let i = 0; i < 12; i++) {
      const col = c[i % c.length]
      stops.push(`${col} ${i * seg}deg ${i * seg + seg - 6}deg`, `transparent ${i * seg + seg - 6}deg ${(i + 1) * seg}deg`)
    }
    return `conic-gradient(${stops.join(', ')})`
  }
  return `conic-gradient(${[...c, c[0]].join(', ')})`
}

/** Anneau décoratif autour d'un avatar de `size` px (rien si décoration inconnue). */
export function AvatarDecoration({ id, size, children }: { id?: string | null; size: number; children: ReactNode }) {
  const deco = DECORATIONS.find(d => d.id === id)
  if (!deco) return <>{children}</>
  const w = Math.max(2, Math.round(size * 0.07 * (deco.thick ?? 1)))
  const off = -(w + 1)
  const anim = deco.anim ? `fc-deco-${deco.anim}` : ''
  const ring: CSSProperties = {}
  const box: CSSProperties = { inset: off }
  if (deco.glow) box.filter = `drop-shadow(0 0 ${Math.max(2, Math.round(w * 0.9))}px ${deco.glow})`
  const borderKind = deco.kind === 'dashed' || deco.kind === 'double'
  if (borderKind) {
    ring.border = `${deco.kind === 'double' ? w + 2 : w}px ${deco.kind === 'double' ? 'double' : 'dashed'} ${deco.colors[0]}`
    // Plusieurs couleurs : une par côté.
    if (deco.colors.length > 1) ring.borderColor = [0, 1, 2, 3].map(i => deco.colors[i % deco.colors.length]).join(' ')
  } else {
    ring.padding = w
    ring.background = ringBackground(deco)
  }
  const glyphSize = Math.max(7, Math.round(size * 0.2))
  const r = size / 2 + w * 0.6
  return (
    <span className="relative inline-flex flex-shrink-0">
      {children}
      <span aria-hidden className="fc-deco" style={box}>
        <span className={`fc-deco-layer ${borderKind ? '' : 'fc-deco-ring'} ${anim}`} style={ring} />
        {deco.kind === 'dual' && <span className="fc-deco-layer fc-deco-dual" style={{ inset: -Math.max(2, Math.round(w * 0.6)), borderColor: deco.colors[deco.colors.length - 1] }} />}
      </span>
      {deco.glyph && size >= 28 && [45, 135, 225, 315].map((a, i) => (
        <span
          key={a}
          aria-hidden
          className="fc-deco-glyph"
          style={{
            left: size / 2 + r * Math.cos((a * Math.PI) / 180) - glyphSize / 2,
            top: size / 2 + r * Math.sin((a * Math.PI) / 180) - glyphSize / 2,
            width: glyphSize, height: glyphSize, fontSize: glyphSize,
            color: deco.glow ?? deco.colors[i % deco.colors.length],
            animationDelay: `${i * 0.45}s`,
          }}
        >{deco.glyph}</span>
      ))}
      {deco.orbit && (
        <span aria-hidden className="fc-deco fc-deco-orbit" style={{ inset: off }}>
          <span style={{ fontSize: Math.max(6, Math.round(size * 0.14)), color: deco.glow ?? deco.colors[deco.colors.length - 1] }}>{deco.orbit}</span>
        </span>
      )}
    </span>
  )
}

/** Particules (et calque éventuel) jouées une fois au montage ; masquées si « réduire les animations ». */
export function ProfileEffect({ id }: { id?: string | null }) {
  const fx = PROFILE_EFFECTS.find(e => e.id === id)
  // Positions tirées une fois par montage (rejouer = remonter avec une autre `key`).
  const parts = useMemo(() => {
    if (!fx) return []
    const n = fx.count ?? 14
    const base = fx.size ?? 10
    return Array.from({ length: n }, (_, i) => {
      const angle = Math.random() * Math.PI * 2
      const dist = 60 + Math.random() * 110
      return {
        left: fx.motion === 'burst' ? 50 : fx.motion === 'diagonal' ? 20 + Math.random() * 90 : Math.random() * 95,
        top: fx.motion === 'twinkle' || fx.motion === 'drift' ? Math.random() * 90
          : fx.motion === 'rise' ? 85 + Math.random() * 10
          : fx.motion === 'burst' ? 35
          : -5 - Math.random() * 10,
        delay: (fx.motion === 'rain' ? i * 0.06 + Math.random() * 0.4 : fx.motion === 'burst' ? Math.floor(i / 9) * 0.6 + Math.random() * 0.15 : i * 0.18 + Math.random() * 0.3).toFixed(2),
        dur: (fx.motion === 'rain' ? 0.7 + Math.random() * 0.5 : fx.motion === 'burst' ? 1.3 + Math.random() * 0.5 : 2.2 + Math.random() * 1.2).toFixed(2),
        size: base + Math.round(Math.random() * (fx.motion === 'rain' ? 6 : 10)),
        char: fx.chars[Math.floor(Math.random() * fx.chars.length)],
        color: fx.colors[Math.floor(Math.random() * fx.colors.length)],
        // Déplacements (px) calculés ici : burst (direction), sway/drift (écart latéral).
        dx: Math.round(fx.motion === 'burst' ? Math.cos(angle) * dist : (Math.random() - 0.5) * 80),
        dy: Math.round(fx.motion === 'burst' ? Math.sin(angle) * dist : (Math.random() - 0.5) * 60),
      }
    })
  }, [fx])
  if (!fx) return null
  return (
    <div className="fc-fx" aria-hidden>
      {fx.overlay && <div className={`fc-fx-ov fc-fx-ov-${fx.overlay}`} />}
      {parts.map((p, i) => (
        <span
          key={i}
          style={{
            left: `${p.left}%`, top: `${p.top}%`, fontSize: p.size, color: p.color,
            animationName: `fc-fx-${fx.motion}`, animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s`,
            ['--fx-dx' as string]: `${p.dx}px`, ['--fx-dy' as string]: `${p.dy}px`,
          }}
        >{p.char}</span>
      ))}
    </div>
  )
}
