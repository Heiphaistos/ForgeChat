import type { TextStyle } from 'react-native'
import type { ResolvedName } from '@/lib/nameStyle'
import { colors } from '@/theme'

const shadow = (color: string, r: number, x = 0, y = 0): TextStyle => ({ textShadowColor: color, textShadowRadius: r, textShadowOffset: { width: x, height: y } })

/**
 * Effets du web en version statique (React Native n'a ni animation CSS ni texte découpé dans
 * un dégradé) : une ombre de texte proche du rendu web (rayon multiplié par l'intensité, `k`),
 * les palettes (arc-en-ciel, feu, or, aurore…) en une couleur par caractère. Couleurs :
 * constantes ou « #rrggbb » résolus.
 */
export function effectStyle(effect: string, color: string | undefined, k = 1): TextStyle | null {
  const c = color ?? colors.text
  switch (effect) {
    case 'glow':
    case 'pulse':
    case 'breathe':
      return shadow(c, 8 * k)
    case 'glow2':
    case 'neon':
    case 'flicker':
      return shadow(c, 12 * k)
    case 'outline':
      return shadow('rgba(0,0,0,0.9)', 2, 1, 1)
    case 'shimmer':
    case 'chrome':
      return shadow('rgba(255,255,255,0.45)', 4 * k)
    case 'gold':
      return shadow('rgba(255,200,60,0.6)', 4 * k)
    case 'shadow3d':
      return shadow('rgba(0,0,0,0.55)', 0.5, 2, 2)
    case 'longshadow':
      return shadow('rgba(0,0,0,0.45)', 1, 3 * k, 3 * k)
    case 'comic':
      return shadow('#000', 0.5, 2 * k, 2 * k)
    case 'emboss':
      return shadow('rgba(255,255,255,0.35)', 0.5, -1, -1)
    case 'letterpress':
      return shadow('rgba(0,0,0,0.85)', 0.5, 0, -1)
    case 'retro':
    case 'vaporwave':
      return shadow('#ff2bd6', 0.5, 2, 2)
    case 'fire':
    case 'lava':
      return shadow('rgba(255,109,0,0.8)', 5 * k)
    case 'frost':
      return shadow('rgba(127,211,255,0.9)', 5 * k)
    case 'holo':
    case 'galaxy':
    case 'stars':
      return shadow('rgba(208,168,255,0.7)', 4 * k)
    case 'aurora':
      return shadow('rgba(124,255,203,0.5)', 5 * k)
    case 'matrix':
    case 'toxic':
      return shadow('rgba(0,255,102,0.8)', 4 * k)
    case 'electric':
      return shadow('#7df9ff', 6 * k)
    case 'smoke':
    case 'ghost':
      return shadow('rgba(200,200,210,0.6)', 6 * k)
    case 'heartbeat':
      return shadow('#ff4d8d', 6 * k)
    case 'pixel':
    case 'scanline':
      return shadow('rgba(0,0,0,0.6)', 0.5, 1, 1)
    case 'glitch':
      return shadow('rgba(0,229,255,0.7)', 0.5, -1.5, 0)
    default:
      return null
  }
}

/**
 * Contour choisi : React Native n'a pas de trait de texte, une ombre serrée l'approche.
 * Double : la couleur extérieure, un peu plus large ; lumineux : ombre diffuse.
 */
export function outlineStyle(o: ResolvedName['outline']): TextStyle | null {
  if (!o) return null
  if (o.style === 'double') return shadow(o.color2 ?? '#ffffff', o.width + 2, 0, 0)
  if (o.style === 'glow') return shadow(o.color, 2 * o.width + 4, 0, 0)
  return shadow(o.color, Math.max(1, o.width), 0, 0)
}

/** Ghost : texte semi-transparent ; letterpress : légèrement atténué. */
export const OPACITY: Record<string, number> = { ghost: 0.7, letterpress: 0.9 }

