/**
 * Personnalisation du profil (gratuite) : mêmes identifiants que la liste blanche
 * du serveur (server/src/models/user.rs) et que le web (components/ui/ProfileDecor.tsx),
 * mêmes couleurs. React Native n'a ni dégradé conique ni animation CSS : rendu approché
 * (components/ProfileDecor.tsx) avec des bordures colorées et Animated (rotation ou
 * pulsation), coupé si « réduire les animations ». Toutes les valeurs sont des constantes.
 */
import type { Key } from '@/i18n'

export interface Decoration {
  id: string
  /** Clé du libellé (traduit au rendu). */
  label: Key
  /** Couleurs réparties sur les côtés de l'anneau (pas de dégradé natif sans dépendance). */
  colors: string[]
  /** Forme du web ; `dual` = anneau + liseré, `segments`/`stripes` = tirets colorés. */
  kind: 'ring' | 'dashed' | 'double' | 'dual' | 'segments' | 'stripes'
  /** Animations du web ramenées à deux mouvements natifs. */
  anim?: 'spin' | 'pulse'
  /** Halo (ombre colorée). */
  glow?: string
  /** Ornement répété autour de l'avatar (4 glyphes fixes). */
  glyph?: string
}

/** Effet de la fiche : particules (glyphes et couleurs du web) et voile coloré éventuel. */
export interface ProfileFx {
  id: string
  label: Key
  chars: string[]
  colors: string[]
  /** Mouvements du web ramenés à trois : montée, chute, scintillement sur place. */
  motion: 'rise' | 'fall' | 'twinkle'
  /** Calque du web (aurore, éclair, brume…) rendu en voile qui apparaît puis s'efface. */
  tint?: string
}

export const DECORATIONS: Decoration[] = [
  { id: 'gold', label: 'settings.decor.gold', colors: ['#f7d774', '#b8860b', '#fff1b8', '#b8860b'], kind: 'ring' },
  { id: 'silver', label: 'settings.decor.silver', colors: ['#f4f6f8', '#8e9aa6', '#ffffff', '#8e9aa6'], kind: 'ring' },
  { id: 'neon', label: 'settings.decor.neon', colors: ['#00f0ff', '#ff00e5'], kind: 'ring', anim: 'spin', glow: '#00f0ff' },
  { id: 'rainbow', label: 'settings.decor.rainbow', colors: ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#af52de'], kind: 'ring', anim: 'spin' },
  { id: 'fire', label: 'settings.decor.fire', colors: ['#ff3d00', '#ffb300', '#ff6d00'], kind: 'ring', anim: 'pulse', glow: '#ff3d00' },
  { id: 'ice', label: 'settings.decor.ice', colors: ['#a8e6ff', '#ffffff', '#5ac8fa'], kind: 'ring' },
  { id: 'emerald', label: 'settings.decor.emerald', colors: ['#2ecc71', '#0b6623', '#7dffb0'], kind: 'ring' },
  { id: 'sakura', label: 'settings.decor.sakura', colors: ['#ffb7c5', '#ff6f91'], kind: 'ring', anim: 'pulse' },
  { id: 'void', label: 'settings.decor.void', colors: ['#6a00ff', '#120024', '#b388ff'], kind: 'ring', anim: 'spin' },
  { id: 'sunset', label: 'settings.decor.sunset', colors: ['#ff7e5f', '#feb47b', '#c471ed'], kind: 'ring' },
  { id: 'ocean', label: 'settings.decor.ocean', colors: ['#00c6ff', '#0072ff'], kind: 'ring', anim: 'spin' },
  { id: 'dashed', label: 'settings.decor.dashed', colors: ['#5ee7df'], kind: 'dashed', anim: 'spin' },
  { id: 'double', label: 'settings.decor.double', colors: ['#b388ff'], kind: 'double' },
  { id: 'glow', label: 'settings.decor.glow', colors: ['#ffffff'], kind: 'ring', anim: 'pulse', glow: '#ffffff' },
  { id: 'holo', label: 'pstyle.deco.holo', colors: ['#ff9ff3', '#a0e7ff', '#c4ffb5', '#fff3a0', '#d0a8ff'], kind: 'ring', anim: 'pulse', glow: '#d0a8ff' },
  { id: 'iridescent', label: 'pstyle.deco.iridescent', colors: ['#7afcff', '#feff9c', '#ff7eb9', '#a0a4ff'], kind: 'ring', anim: 'pulse' },
  { id: 'prism', label: 'pstyle.deco.prism', colors: ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#af52de'], kind: 'segments', anim: 'pulse', glyph: '◆' },
  { id: 'opal', label: 'pstyle.deco.opal', colors: ['#e0f7fa', '#f8bbd0', '#b2ebf2', '#fff9c4', '#d1c4e9'], kind: 'ring', anim: 'pulse' },
  { id: 'pearl', label: 'pstyle.deco.pearl', colors: ['#fdfcfb', '#e2d1c3', '#ffffff', '#d7e1ec'], kind: 'dual', glow: '#ffffff' },
  { id: 'aurora', label: 'pstyle.deco.aurora', colors: ['#00ffa3', '#00b4ff', '#8a2be2', '#00ffa3'], kind: 'ring', anim: 'pulse', glow: '#00ffa3' },
  { id: 'chroma', label: 'pstyle.deco.chroma', colors: ['#ff0080', '#7928ca', '#0070f3', '#00dfd8'], kind: 'ring', anim: 'spin', glow: '#7928ca' },
  { id: 'mirage', label: 'pstyle.deco.mirage', colors: ['#fbc2eb', '#a6c1ee', '#fbc2eb'], kind: 'dual', anim: 'pulse' },
  { id: 'inferno', label: 'pstyle.deco.inferno', colors: ['#ff1e00', '#ff8a00', '#ffd000', '#ff1e00'], kind: 'ring', anim: 'pulse', glow: '#ff5a00', glyph: '▲' },
  { id: 'ember', label: 'pstyle.deco.ember', colors: ['#7a1500', '#ff5a1f', '#ffb347'], kind: 'ring', anim: 'pulse' },
  { id: 'frost', label: 'pstyle.deco.frost', colors: ['#e0f7ff', '#8fd3ff', '#ffffff'], kind: 'ring', glow: '#bdeeff', glyph: '❄' },
  { id: 'glacier', label: 'pstyle.deco.glacier', colors: ['#3a7bd5', '#00d2ff', '#e0f7ff'], kind: 'segments', anim: 'spin' },
  { id: 'lightning', label: 'pstyle.deco.lightning', colors: ['#fff700', '#ffffff', '#7df9ff'], kind: 'dashed', anim: 'pulse', glow: '#fff700', glyph: '⚡' },
  { id: 'storm', label: 'pstyle.deco.storm', colors: ['#2c3e50', '#7df9ff', '#4b6cb7'], kind: 'ring', anim: 'pulse', glow: '#7df9ff' },
  { id: 'tide', label: 'pstyle.deco.tide', colors: ['#004e92', '#00c9ff', '#92fe9d', '#004e92'], kind: 'ring', anim: 'spin' },
  { id: 'magma', label: 'pstyle.deco.magma', colors: ['#200122', '#ff3c00', '#6f0000'], kind: 'ring', anim: 'pulse', glow: '#ff3c00' },
  { id: 'terra', label: 'pstyle.deco.terra', colors: ['#5d4037', '#8bc34a', '#a1887f', '#33691e'], kind: 'segments', glyph: '❦' },
  { id: 'zephyr', label: 'pstyle.deco.zephyr', colors: ['#e0ffff', '#a8edea', '#fed6e3'], kind: 'dashed', anim: 'spin' },
  { id: 'toxic', label: 'pstyle.deco.toxic', colors: ['#39ff14', '#0b3d02', '#c6ff00'], kind: 'stripes', anim: 'spin', glow: '#39ff14' },
  { id: 'plasma', label: 'pstyle.deco.plasma', colors: ['#f72585', '#7209b7', '#4cc9f0', '#f72585'], kind: 'ring', anim: 'spin', glow: '#f72585' },
  { id: 'neon_pink', label: 'pstyle.deco.neon_pink', colors: ['#ff2bd6'], kind: 'dual', anim: 'pulse', glow: '#ff2bd6' },
  { id: 'neon_cyan', label: 'pstyle.deco.neon_cyan', colors: ['#00f0ff'], kind: 'dual', anim: 'pulse', glow: '#00f0ff' },
  { id: 'neon_lime', label: 'pstyle.deco.neon_lime', colors: ['#b6ff00'], kind: 'dual', anim: 'pulse', glow: '#b6ff00' },
  { id: 'synthwave', label: 'pstyle.deco.synthwave', colors: ['#ff2bd6', '#ff9a00', '#00e5ff', '#ff2bd6'], kind: 'ring', anim: 'spin', glow: '#ff2bd6' },
  { id: 'cyberpunk', label: 'pstyle.deco.cyberpunk', colors: ['#fcee0a', '#00f0ff'], kind: 'stripes', anim: 'spin', glow: '#fcee0a' },
  { id: 'laser', label: 'pstyle.deco.laser', colors: ['#ff0040', '#ff0040', 'transparent', '#00ff9f', '#00ff9f', 'transparent'], kind: 'ring', anim: 'spin', glow: '#ff0040' },
  { id: 'pixel', label: 'pstyle.deco.pixel', colors: ['#5b6ee1', '#99e550', '#fbf236', '#d95763'], kind: 'segments', anim: 'spin' },
  { id: 'pixel_rainbow', label: 'pstyle.deco.pixel_rainbow', colors: ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#af52de'], kind: 'segments', anim: 'spin' },
  { id: 'arcade', label: 'pstyle.deco.arcade', colors: ['#ffcc00', '#000000'], kind: 'segments', anim: 'spin', glyph: '■' },
  { id: 'halloween', label: 'pstyle.deco.halloween', colors: ['#ff7518', '#2b0a3d'], kind: 'stripes', glow: '#ff7518', glyph: '☾' },
  { id: 'christmas', label: 'pstyle.deco.christmas', colors: ['#d42426', '#ffffff'], kind: 'stripes', anim: 'spin', glyph: '★' },
  { id: 'winter', label: 'pstyle.deco.winter', colors: ['#dff6ff', '#9bd4ff', '#ffffff'], kind: 'ring', anim: 'pulse', glyph: '❅' },
  { id: 'spring', label: 'pstyle.deco.spring', colors: ['#b8f2a6', '#ffd1dc', '#fff6a6'], kind: 'ring', glyph: '✿' },
  { id: 'summer', label: 'pstyle.deco.summer', colors: ['#ffd200', '#f7971e', '#00c6ff'], kind: 'ring', anim: 'spin', glyph: '☀' },
  { id: 'autumn', label: 'pstyle.deco.autumn', colors: ['#d35400', '#f39c12', '#8e2b0b', '#e67e22'], kind: 'ring', glyph: '❦' },
  { id: 'valentine', label: 'pstyle.deco.valentine', colors: ['#ff4d6d', '#ffb3c1', '#c9184a'], kind: 'ring', anim: 'pulse', glow: '#ff4d6d', glyph: '♥' },
  { id: 'easter', label: 'pstyle.deco.easter', colors: ['#ffd6e0', '#c1f0c1', '#fff5ba', '#c5d7ff'], kind: 'stripes', glyph: '✿' },
  { id: 'newyear', label: 'pstyle.deco.newyear', colors: ['#ffd700', '#1a1a2e', '#ffd700', '#c0c0c0'], kind: 'ring', anim: 'spin', glow: '#ffd700', glyph: '✦' },
  { id: 'lunar', label: 'pstyle.deco.lunar', colors: ['#c1121f', '#ffd166'], kind: 'dual', glow: '#ffd166', glyph: '✺' },
  { id: 'galaxy', label: 'pstyle.deco.galaxy', colors: ['#0f0c29', '#6a3093', '#a044ff', '#24243e'], kind: 'ring', anim: 'spin', glow: '#a044ff', glyph: '✧' },
  { id: 'nebula', label: 'pstyle.deco.nebula', colors: ['#ff6ec4', '#7873f5', '#4adede', '#ff6ec4'], kind: 'ring', anim: 'pulse', glow: '#7873f5' },
  { id: 'starry', label: 'pstyle.deco.starry', colors: ['#141e30', '#243b55', '#ffd166'], kind: 'ring', glyph: '★' },
  { id: 'moonlit', label: 'pstyle.deco.moonlit', colors: ['#cfd9df', '#2c3e50', '#e2ebf0'], kind: 'dual', glow: '#cfd9df', glyph: '☾' },
  { id: 'solar', label: 'pstyle.deco.solar', colors: ['#ffef00', '#ff8c00', '#ff4500', '#ffef00'], kind: 'ring', anim: 'spin', glow: '#ff8c00' },
  { id: 'orbit', label: 'pstyle.deco.orbit', colors: ['#8e9aff'], kind: 'dashed' },
  { id: 'comet', label: 'pstyle.deco.comet', colors: ['transparent', 'transparent', '#7df9ff', '#ffffff'], kind: 'ring', anim: 'spin', glow: '#7df9ff' },
  { id: 'royal', label: 'pstyle.deco.royal', colors: ['#4b0082', '#ffd700', '#4b0082', '#ffd700'], kind: 'dual', glow: '#ffd700', glyph: '♛' },
  { id: 'diamond', label: 'pstyle.deco.diamond', colors: ['#ffffff', '#b9f2ff', '#e0e0e0', '#ffffff'], kind: 'segments', anim: 'pulse', glow: '#b9f2ff', glyph: '◆' },
  { id: 'ruby', label: 'pstyle.deco.ruby', colors: ['#9b111e', '#e0115f', '#ff6f91'], kind: 'ring', glow: '#e0115f' },
  { id: 'sapphire', label: 'pstyle.deco.sapphire', colors: ['#0f52ba', '#6ca0dc', '#082567'], kind: 'ring', glow: '#0f52ba' },
  { id: 'amethyst', label: 'pstyle.deco.amethyst', colors: ['#9966cc', '#5d3a9b', '#d8bfd8'], kind: 'ring', glow: '#9966cc' },
]

export const PROFILE_EFFECTS: ProfileFx[] = [
  { id: 'sparkles', label: 'settings.decor.sparkles', chars: ['✦'], colors: ['#ffe680'], motion: 'twinkle' },
  { id: 'snow', label: 'settings.decor.snow', chars: ['❄'], colors: ['#e6f4ff'], motion: 'fall' },
  { id: 'hearts', label: 'settings.decor.hearts', chars: ['♥'], colors: ['#ff5c8a'], motion: 'rise' },
  { id: 'stars', label: 'settings.decor.stars', chars: ['★'], colors: ['#ffd166'], motion: 'fall' },
  { id: 'bubbles', label: 'settings.decor.bubbles', chars: ['○'], colors: ['#9be7ff'], motion: 'rise' },
  { id: 'rain', label: 'pstyle.fx.rain', chars: ['│'], colors: ['#8fc9ff', '#5aa9e6'], motion: 'fall' },
  { id: 'storm', label: 'pstyle.fx.storm', chars: ['│'], colors: ['#9fb8d6'], motion: 'fall', tint: 'rgba(220,235,255,0.35)' },
  { id: 'sakura', label: 'pstyle.fx.sakura', chars: ['✿', '❀'], colors: ['#ffb7c5', '#ff8fab', '#ffe5ec'], motion: 'fall' },
  { id: 'leaves', label: 'pstyle.fx.leaves', chars: ['❦', '❧'], colors: ['#d35400', '#f39c12', '#a04000', '#e67e22'], motion: 'fall' },
  { id: 'confetti', label: 'pstyle.fx.confetti', chars: ['■', '▲', '●', '▬'], colors: ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#af52de'], motion: 'fall' },
  { id: 'fireworks', label: 'pstyle.fx.fireworks', chars: ['✸', '✺', '✦', '·'], colors: ['#ffd166', '#ff5c8a', '#5ee7df', '#b388ff', '#ffffff'], motion: 'twinkle' },
  { id: 'embers', label: 'pstyle.fx.embers', chars: ['•', '●'], colors: ['#ff6d00', '#ffb300', '#ff3d00'], motion: 'rise' },
  { id: 'fire', label: 'pstyle.fx.fire', chars: ['●'], colors: ['#ff3d00', '#ff9100', '#ffd600'], motion: 'rise' },
  { id: 'aurora', label: 'pstyle.fx.aurora', chars: [], colors: [], motion: 'twinkle', tint: 'rgba(0,255,163,0.22)' },
  { id: 'matrix', label: 'pstyle.fx.matrix', chars: ['ア', 'カ', 'サ', 'タ', 'ナ', 'ハ', 'マ', '0', '1', 'ﾘ', 'ﾂ'], colors: ['#00ff41', '#00c832', '#a6ffb0'], motion: 'fall' },
  { id: 'galaxy', label: 'pstyle.fx.galaxy', chars: ['✧', '✦', '⋆', '·'], colors: ['#ffffff', '#c3b1ff', '#8ec5ff'], motion: 'twinkle', tint: 'rgba(120,115,245,0.22)' },
  { id: 'meteors', label: 'pstyle.fx.meteors', chars: ['☄', '✦'], colors: ['#ffffff', '#7df9ff', '#ffd166'], motion: 'fall' },
  { id: 'fireflies', label: 'pstyle.fx.fireflies', chars: ['●'], colors: ['#f9ff8a', '#d4ff4f'], motion: 'twinkle' },
  { id: 'notes', label: 'pstyle.fx.notes', chars: ['♪', '♫', '♬'], colors: ['#b388ff', '#5ee7df', '#ff8fab'], motion: 'rise' },
  { id: 'coins', label: 'pstyle.fx.coins', chars: ['◉', '●'], colors: ['#ffd700', '#ffb300', '#fff1b8'], motion: 'fall' },
  { id: 'gems', label: 'pstyle.fx.gems', chars: ['◆', '◇', '⬥'], colors: ['#e0115f', '#0f52ba', '#50c878', '#9966cc', '#b9f2ff'], motion: 'twinkle' },
  { id: 'petals', label: 'pstyle.fx.petals', chars: ['❀', '❁'], colors: ['#ffffff', '#ffe4ef', '#fff6d6'], motion: 'fall' },
  { id: 'lightning', label: 'pstyle.fx.lightning', chars: ['⚡'], colors: ['#fff700', '#7df9ff'], motion: 'twinkle', tint: 'rgba(220,235,255,0.35)' },
  { id: 'sunrays', label: 'pstyle.fx.sunrays', chars: [], colors: [], motion: 'twinkle', tint: 'rgba(255,214,102,0.22)' },
  { id: 'moonlight', label: 'pstyle.fx.moonlight', chars: ['✧', '·', '☾'], colors: ['#e2ebf0', '#a8c0ff'], motion: 'twinkle', tint: 'rgba(40,60,120,0.28)' },
  { id: 'love', label: 'pstyle.fx.love', chars: ['♥', '❤'], colors: ['#ff4d6d', '#ff8fab', '#ffb3c1'], motion: 'twinkle' },
  { id: 'soap', label: 'pstyle.fx.soap', chars: ['○', '◯'], colors: ['#ff9ff3', '#a0e7ff', '#c4ffb5', '#fff3a0', '#d0a8ff'], motion: 'rise' },
  { id: 'blizzard', label: 'pstyle.fx.blizzard', chars: ['❄', '❅', '❆', '·'], colors: ['#ffffff', '#dff6ff'], motion: 'fall' },
  { id: 'pixels', label: 'pstyle.fx.pixels', chars: ['■'], colors: ['#5b6ee1', '#99e550', '#fbf236', '#d95763', '#ffffff'], motion: 'fall' },
  { id: 'glitch', label: 'pstyle.fx.glitch', chars: [], colors: [], motion: 'twinkle', tint: 'rgba(255,0,80,0.18)' },
  { id: 'rainbow', label: 'pstyle.fx.rainbow', chars: [], colors: [], motion: 'twinkle', tint: 'rgba(175,82,222,0.2)' },
  { id: 'mist', label: 'pstyle.fx.mist', chars: [], colors: [], motion: 'twinkle', tint: 'rgba(255,255,255,0.16)' },
  { id: 'spooky', label: 'pstyle.fx.spooky', chars: ['☾', '✦', '✖', '⁂'], colors: ['#ff7518', '#9d4edd', '#c7f464'], motion: 'fall' },
  { id: 'festive', label: 'pstyle.fx.festive', chars: ['❄', '★', '●'], colors: ['#d42426', '#2f9e44', '#ffd700', '#ffffff'], motion: 'fall' },
  { id: 'synthwave', label: 'pstyle.fx.synthwave', chars: [], colors: [], motion: 'twinkle', tint: 'rgba(255,43,214,0.2)' },
  { id: 'stardust', label: 'pstyle.fx.stardust', chars: ['·', '•', '✦'], colors: ['#ffd700', '#fff1b8', '#ffe680'], motion: 'twinkle' },
  { id: 'plasma', label: 'pstyle.fx.plasma', chars: [], colors: [], motion: 'twinkle', tint: 'rgba(114,9,183,0.24)' },
  { id: 'ocean', label: 'pstyle.fx.ocean', chars: ['○', '∘'], colors: ['#9be7ff', '#e0f7ff'], motion: 'rise', tint: 'rgba(0,120,200,0.24)' },
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
