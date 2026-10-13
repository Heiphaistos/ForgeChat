/**
 * Personnalisation du profil (gratuite) : catalogue des décorations d'avatar et des effets de
 * la fiche, réglages de la décoration et intensité de l'effet. Identifiants identiques, dans le
 * même ordre, à la liste blanche du serveur (server/src/models/user.rs) et au mobile
 * (mobile/src/features/account/profileDecor.ts). Rendu : components/ui/ProfileDecor.tsx.
 * Tout est dessiné en CSS et SVG en ligne : aucune image ni requête réseau. Les couleurs sont des
 * constantes de ce fichier ; les réglages de l'utilisateur ne deviennent que des nombres bornés.
 * Pur TypeScript (sans JSX) : testé par scripts/profileDecor.test.mjs.
 */
import type { Key } from '../i18n'
import { DECORATIONS_MORE, DECO_GROUPS_MORE, FX_GROUPS as FX_GROUPS_MORE, PROFILE_EFFECTS_MORE } from './profileDecorMore.ts'
import { DECORATIONS_EXTRA, DECO_GROUPS_EXTRA, FX_GROUPS_EXTRA, PROFILE_EFFECTS_EXTRA } from './profileDecorExtra.ts'

/** Forme de l'anneau. */
export type DecoKind =
  | 'ring'       // dégradé conique plein
  | 'dashed'     // bordure en tirets
  | 'double'     // bordure double
  | 'stripes'    // rayures (sucre d'orge, danger)
  | 'segments'   // segments séparés (pixel, arcade)
  | 'dual'       // anneau + fin liseré extérieur
  | 'frame'      // cadre carré aux coins arrondis
  | 'pixelframe' // cadre carré en segments, coins droits
/** Animation de l'anneau (profileStyles.css, coupée si « réduire les animations »). */
export type DecoAnim = 'spin' | 'spinrev' | 'pulse' | 'hue' | 'flicker' | 'flash' | 'steps' | 'breathe'
/** Accessoire dessiné en SVG autour de l'avatar (components/ui/DecoOrnament.tsx). */
export type Ornament =
  | 'crown' | 'tiara' | 'halo' | 'horns' | 'catears' | 'foxears' | 'bunnyears' | 'headphones'
  | 'wings' | 'fairywings' | 'batwings' | 'antlers' | 'bow' | 'partyhat' | 'witchhat' | 'santahat' | 'laurel'

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
  /** Nombre de particules en orbite, réparties régulièrement (1 par défaut). */
  orbitN?: number
  /** Couronne de glyphes (un par caractère) qui tourne lentement : runes, fleurs… */
  wreath?: string
  /** Aura pulsante autour de l'anneau. */
  aura?: string
  /** Ondes concentriques qui s'élargissent. */
  ripple?: string
  /** Particules qui tombent, montent ou scintillent autour de l'avatar (un glyphe par caractère). */
  rain?: { chars: string; motion: 'fall' | 'rise' | 'twinkle' }
  /** Flammes qui dansent autour de l'anneau (couleurs de l'anneau). */
  flames?: boolean
  /** Arcs électriques (couleur). */
  arcs?: string
  ornament?: Ornament
  /** Épaisseur relative (1 = défaut). */
  thick?: number
}

/** Mouvement d'une particule d'effet (keyframes fc-fx-<motion> de index.css / profileStyles.css). */
export type FxMotion =
  | 'fall' | 'rise' | 'twinkle' | 'sway' | 'rain' | 'burst' | 'confetti' | 'drift' | 'diagonal'
  | 'swirl' | 'float' | 'flap' | 'smoke'
/** Calque plein écran de l'effet (fc-fx-ov-<overlay>). */
export type FxOverlay =
  | 'aurora' | 'flash' | 'sunrays' | 'glitch' | 'rainbow' | 'mist' | 'synthwave' | 'plasma' | 'ocean' | 'nebula' | 'moon'
  | 'fog' | 'sand' | 'blossom' | 'dusk' | 'caustics' | 'lava' | 'heat' | 'static' | 'northern' | 'galaxy' | 'blackhole'
  | 'sunset' | 'godrays' | 'disco' | 'spotlight' | 'heartbeat' | 'globe' | 'grid' | 'retrosun' | 'vapor' | 'scanlines'
  | 'radar' | 'hologram' | 'vhs' | 'equalizer' | 'portal'

export type ProfileFx = {
  id: string
  label: Key
  /** Glyphes tirés au hasard pour chaque particule (aucun si effet de calque seul). */
  chars: string[]
  colors: string[]
  motion: FxMotion
  overlay?: FxOverlay
  /** Nombre de particules (14 par défaut), multiplié par l'intensité. */
  count?: number
  /** Taille de base en px. */
  size?: number
  /** Particule dessinée en CSS (fc-fx-shape-<shape>) au lieu du glyphe. */
  shape?: 'ghost' | 'bat' | 'pumpkin'
}

const RAINBOW = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#af52de']
const HOLO = ['#ff9ff3', '#a0e7ff', '#c4ffb5', '#fff3a0', '#d0a8ff']

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
  ...DECO_GROUPS_MORE,
  ...DECO_GROUPS_EXTRA,
]
/** Catégories du sélecteur d'effets (dans l'ordre d'affichage). */
export const FX_GROUPS = [...FX_GROUPS_MORE, ...FX_GROUPS_EXTRA]

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
  ...DECORATIONS_MORE,
  ...DECORATIONS_EXTRA,
]

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
  ...PROFILE_EFFECTS_MORE,
  ...PROFILE_EFFECTS_EXTRA,
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

// ── Réglages de la décoration (users.avatar_decoration_opts) ─────────────────

export interface DecoOpts {
  animate: boolean
  direction: 'cw' | 'ccw'
  /** Vitesse en %. */
  speed: number
  pulse: boolean
  brightness: number
  saturation: number
  /** Intensité du halo en %. */
  glow: number
  opacity: number
  /** Décalage de teinte en degrés. */
  hue: number
  /** Taille en %. */
  scale: number
  /** Couleur de teinte 0xRRGGBB, mélangée aux couleurs de la décoration. */
  tint: number | null
}

export const DECO_OPTS_DEFAULT: Readonly<DecoOpts> = {
  animate: true, direction: 'cw', speed: 100, pulse: false, brightness: 100, saturation: 100,
  glow: 100, opacity: 100, hue: 0, scale: 100, tint: null,
}

/** Bornes des réglages numériques : mêmes que models/profile_style.rs (le serveur refuse au-delà). */
export const DECO_RANGES = {
  speed: [25, 400],
  brightness: [50, 200],
  saturation: [0, 200],
  glow: [0, 300],
  opacity: [20, 100],
  hue: [0, 360],
  scale: [80, 130],
} as const satisfies Record<string, readonly [number, number]>
export type DecoNumKey = keyof typeof DECO_RANGES

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/** Réglages reçus nettoyés (garde contre un cache ancien ou une réponse inattendue) :
 *  toujours un objet complet, chaque nombre entier et borné. */
export function cleanDecoOpts(raw: unknown): DecoOpts {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const out: DecoOpts = { ...DECO_OPTS_DEFAULT }
  if (typeof o.animate === 'boolean') out.animate = o.animate
  if (o.direction === 'cw' || o.direction === 'ccw') out.direction = o.direction
  if (typeof o.pulse === 'boolean') out.pulse = o.pulse
  for (const k of Object.keys(DECO_RANGES) as DecoNumKey[]) {
    const v = o[k]
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = clamp(Math.round(v), DECO_RANGES[k][0], DECO_RANGES[k][1])
  }
  if (typeof o.tint === 'number' && Number.isInteger(o.tint) && o.tint >= 0 && o.tint <= 0xffffff) out.tint = o.tint
  return out
}

/** Corps envoyé à PATCH /users/me : seulement ce qui diffère du défaut (`{}` = défaut). */
export function decoOptsPayload(o: DecoOpts): Record<string, number | boolean | string> {
  const c = cleanDecoOpts(o)
  const out: Record<string, number | boolean | string> = {}
  for (const k of Object.keys(DECO_OPTS_DEFAULT) as (keyof DecoOpts)[]) {
    const v = c[k]
    if (v !== DECO_OPTS_DEFAULT[k] && v != null) out[k] = v
  }
  return out
}

export const isDefaultDecoOpts = (o: DecoOpts) => Object.keys(decoOptsPayload(o)).length === 0

/** Couleur constante « #rrggbb » mélangée à la teinte choisie (k = part de la teinte) ;
 *  « transparent » et toute autre écriture restent inchangés. */
export function tintColor(c: string, tint: number | null, k = 0.6): string {
  if (tint == null || !/^#[0-9a-f]{6}$/i.test(c)) return c
  const a = parseInt(c.slice(1), 16)
  const mix = (sh: number) => Math.round(((a >> sh) & 255) * (1 - k) + ((tint >> sh) & 255) * k)
  return hexColor((mix(16) << 16) | (mix(8) << 8) | mix(0))
}

/**
 * Variables CSS de la décoration (profileStyles.css, .fc-deco-root) : uniquement des nombres
 * tirés de réglages nettoyés et une couleur « #rrggbb » calculée, jamais une chaîne reçue.
 */
export function decoVars(o: DecoOpts, glow: { color: string; radius: number }): Record<string, string> {
  return {
    '--deco-speed': String(o.speed / 100),
    '--deco-turn': o.direction === 'ccw' ? '-1' : '1',
    '--deco-hue': `${o.hue}deg`,
    '--deco-bright': String(o.brightness / 100),
    '--deco-sat': String(o.saturation / 100),
    '--deco-opacity': String(o.opacity / 100),
    '--deco-glow-r': `${Math.round(glow.radius * 10) / 10}px`,
    '--deco-glow-c': glow.color,
  }
}

/** Halo de la décoration : celui du catalogue multiplié par le réglage ; une décoration
 *  sans halo en reçoit un (première couleur) quand le réglage dépasse 100 %. */
export function decoGlow(deco: Deco, w: number, o: DecoOpts): { color: string; radius: number } {
  const base = Math.max(2, Math.round(w * 0.9))
  if (deco.glow) return o.glow > 0 ? { color: tintColor(deco.glow, o.tint), radius: (base * o.glow) / 100 } : { color: 'transparent', radius: 0 }
  if (o.glow <= 100) return { color: 'transparent', radius: 0 }
  const first = deco.colors.find(c => c.startsWith('#')) ?? '#ffffff'
  return { color: tintColor(first, o.tint), radius: (base * (o.glow - 100)) / 100 }
}

// ── Intensité de l'effet de profil (users.profile_effect_intensity) ───────────

export const FX_INTENSITY: readonly [number, number] = [25, 200]

export function cleanIntensity(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(Math.round(v), FX_INTENSITY[0], FX_INTENSITY[1]) : 100
}

/** Nombre de particules d'un effet à l'intensité donnée (au plus 90 pour rester léger). */
export function fxCount(fx: ProfileFx, intensity = 100): number {
  if (!fx.chars.length && !fx.shape) return 0
  return Math.min(90, Math.max(1, Math.round(((fx.count ?? 14) * cleanIntensity(intensity)) / 100)))
}

// ── Sélecteurs ──────────────────────────────────────────────────────────────

/** Texte comparable pour la recherche : minuscules, sans accents. */
export const searchKey = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()

/** La recherche `q` (déjà passée par searchKey) trouve-t-elle l'un de ces textes ? */
export const matches = (q: string, ...texts: string[]) => !q || texts.some(t => searchKey(t).includes(q))

/** Glyphes d'une chaîne (un par point de code, pour les runes et symboles hors BMP). */
export const glyphs = (s: string) => Array.from(s)
