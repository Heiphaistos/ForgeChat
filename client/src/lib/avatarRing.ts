/**
 * Anneau d'avatar du profil de serveur (server_members.server_avatar_ring, validé par
 * models/profile_style::parse_avatar_ring) : 1 à 3 couleurs, épaisseur 1-8 px, style en liste
 * blanche, vitesse, sens, luminosité et lueur bornés. Même liste et mêmes bornes que le serveur
 * et le mobile (mobile/src/components/AvatarRing.tsx). Pur TypeScript : testé par
 * scripts/profileDecor.test.mjs. Seuls des « #rrggbb » issus d'entiers et des nombres arrivent
 * dans le style.
 */
export const RING_STYLES = [
  'solid', 'dashed', 'dotted', 'double', 'glow', 'spin', 'pulse',
  'gradient_spin', 'rainbow', 'dashed_spin', 'neon_pulse', 'comet', 'segmented', 'breathe',
] as const
export type RingStyle = (typeof RING_STYLES)[number]
export const RING_WIDTH_MAX = 8
/** Bornes en % : mêmes que models/profile_style.rs (SPEED_RANGE, BRIGHTNESS_RANGE, GLOW_RANGE). */
export const RING_RANGES = { speed: [25, 400], brightness: [50, 200], glow: [0, 300] } as const

export interface AvatarRingData {
  colors: number[]
  width: number
  style: RingStyle
  /** Vitesse en % (100 par défaut). */
  speed?: number
  direction?: 'cw' | 'ccw'
  brightness?: number
  glow?: number
}

/** Styles qui bougent (classe fc-ring-<style> de profileStyles.css). */
export const RING_ANIMATED: readonly RingStyle[] = ['spin', 'pulse', 'gradient_spin', 'rainbow', 'dashed_spin', 'neon_pulse', 'comet', 'breathe']
/** Styles lumineux par nature (lueur de base). */
const RING_GLOWING: readonly RingStyle[] = ['glow', 'pulse', 'neon_pulse', 'breathe', 'comet']

const RAINBOW = [0xff3b30, 0xff9500, 0xffcc00, 0x34c759, 0x007aff, 0xaf52de]

const pct = (v: unknown, [min, max]: readonly [number, number]) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : 100

/** Anneau reçu nettoyé (garde contre un cache ancien) ; null = pas d'anneau. */
export function cleanRing(r: unknown): AvatarRingData | null {
  if (!r || typeof r !== 'object') return null
  const o = r as Record<string, unknown>
  const colors = Array.isArray(o.colors)
    ? o.colors.filter((c): c is number => Number.isInteger(c) && c >= 0 && c <= 0xffffff).slice(0, 3)
    : []
  if (!colors.length) return null
  const width = Number.isInteger(o.width) ? Math.min(RING_WIDTH_MAX, Math.max(1, o.width as number)) : 3
  const style = (RING_STYLES as readonly unknown[]).includes(o.style) ? (o.style as RingStyle) : 'solid'
  const out: AvatarRingData = { colors, width, style }
  const speed = pct(o.speed, RING_RANGES.speed)
  const brightness = pct(o.brightness, RING_RANGES.brightness)
  const glow = pct(o.glow, RING_RANGES.glow)
  if (speed !== 100) out.speed = speed
  if (o.direction === 'ccw') out.direction = 'ccw'
  if (brightness !== 100) out.brightness = brightness
  if (glow !== 100) out.glow = glow
  return out
}

const hex = (c: number) => '#' + (c >>> 0 & 0xffffff).toString(16).padStart(6, '0')

/** Ce qu'il faut dessiner pour un anneau nettoyé, autour d'un avatar de `size` px. */
export function ringLook(r: AvatarRingData, size: number) {
  // Épaisseur réduite sur les petits avatars (liste des membres, messages).
  const w = Math.max(1, Math.round(r.width * Math.min(1, size / 72)))
  const gap = Math.max(1, Math.round(w / 2))
  const cs = (r.style === 'rainbow' ? RAINBOW : r.colors).map(hex)
  const border = r.style === 'dashed' || r.style === 'dotted' || r.style === 'double' || r.style === 'dashed_spin'
  const borderStyle = r.style === 'dashed_spin' ? 'dashed' : r.style
  let background: string | undefined
  if (!border) {
    if (r.style === 'comet') {
      background = `conic-gradient(transparent 0deg, transparent 80deg, ${cs[cs.length - 1]}55 200deg, ${cs[0]} 360deg)`
    } else if (r.style === 'segmented') {
      const stops: string[] = []
      for (let i = 0; i < 12; i++) stops.push(`${cs[i % cs.length]} ${i * 30}deg ${i * 30 + 22}deg`, `transparent ${i * 30 + 22}deg ${(i + 1) * 30}deg`)
      background = `conic-gradient(${stops.join(', ')})`
    } else if (r.style === 'gradient_spin') {
      background = `conic-gradient(${[...cs, ...cs, cs[0]].join(', ')})`
    } else {
      background = cs.length > 1 ? `conic-gradient(${[...cs, cs[0]].join(', ')})` : cs[0]
    }
  }
  const glowPct = r.glow ?? 100
  const base = Math.max(2, w)
  const glowR = RING_GLOWING.includes(r.style) ? (base * glowPct) / 100 : glowPct > 100 ? (base * (glowPct - 100)) / 100 : 0
  const vars: Record<string, string> = {
    '--ring-speed': String((r.speed ?? 100) / 100),
    '--deco-turn': r.direction === 'ccw' ? '-1' : '1',
    '--ring-bright': String((r.brightness ?? 100) / 100),
    '--ring-glow-r': `${Math.round(glowR * 10) / 10}px`,
    '--ring-glow-c': glowR > 0 ? cs[0] : 'transparent',
  }
  return {
    w, gap, cs, border, borderStyle, background, vars,
    filtered: glowR > 0 || (r.brightness ?? 100) !== 100 || r.style === 'breathe',
    animated: RING_ANIMATED.includes(r.style),
  }
}
