/**
 * Anneau d'avatar v2 : celui du profil de serveur (server_members.server_avatar_ring) et l'anneau
 * global du compte (users.avatar_ring), validés par server/src/models/avatar_ring.rs. 1 à 8 couleurs,
 * épaisseur 1-12 px, 34 styles en liste blanche, remplissage, angle, forme, écart, segments,
 * vitesse, sens, luminosité, lueur, opacité et intensité bornés. Mêmes listes et mêmes bornes que
 * le serveur et le mobile. Pur TypeScript : testé par scripts/profileDecor.test.mjs.
 * Seuls des « #rrggbb » issus d'entiers et des nombres arrivent dans le style.
 */
export const RING_STYLES = [
  'solid', 'dashed', 'dotted', 'double', 'glow', 'spin', 'pulse',
  'gradient_spin', 'rainbow', 'dashed_spin', 'neon_pulse', 'comet', 'segmented', 'breathe',
  'orbit', 'double_orbit', 'aurora', 'fire', 'electric', 'wave', 'heartbeat', 'sparkle', 'radar', 'prism',
  'chase', 'ripple', 'glitch', 'twin_comet', 'stripes', 'flicker', 'halo', 'sunburst', 'vortex', 'matrix',
] as const
export type RingStyle = (typeof RING_STYLES)[number]
export const RING_FILLS = ['conic', 'linear', 'radial'] as const
export type RingFill = (typeof RING_FILLS)[number]
export const RING_SHAPES = ['circle', 'rounded', 'squircle'] as const
export type RingShape = (typeof RING_SHAPES)[number]
export const RING_COLORS_MAX = 8
export const RING_WIDTH_MAX = 12
export const RING_GAP_MAX = 8
/** Bornes : mêmes que avatar_ring.rs (SPEED_RANGE, …, RING_SEGMENTS_RANGE, INTENSITY_RANGE). */
export const RING_RANGES = {
  speed: [25, 400], brightness: [50, 200], glow: [0, 300], opacity: [20, 100], intensity: [25, 200],
  segments: [2, 24], angle: [0, 360],
} as const
export type RingNumKey = keyof typeof RING_RANGES
/** Valeurs par défaut : jamais envoyées (le serveur ne les sérialise pas). */
export const RING_DEFAULTS: Record<RingNumKey, number> = {
  speed: 100, brightness: 100, glow: 100, opacity: 100, intensity: 100, segments: 12, angle: 0,
}

export interface AvatarRingData {
  colors: number[]
  width: number
  style: RingStyle
  fill?: RingFill
  /** Rotation de départ du dégradé, en degrés. */
  angle?: number
  shape?: RingShape
  /** Écart avatar / anneau en px ; absent = automatique. */
  gap?: number
  segments?: number
  /** Vitesse en % (100 par défaut). */
  speed?: number
  direction?: 'cw' | 'ccw'
  brightness?: number
  glow?: number
  opacity?: number
  /** Amplitude de l'animation en % (pulsation, scintillement…). */
  intensity?: number
}

/** Styles qui bougent (classe fc-ring-<style> de ringStyles.css) ; tous sauf les statiques. */
const STATIC: readonly RingStyle[] = ['solid', 'dashed', 'dotted', 'double', 'glow', 'segmented', 'stripes', 'halo']
export const RING_ANIMATED: readonly RingStyle[] = RING_STYLES.filter(s => !STATIC.includes(s))
export const RING_STATIC: readonly RingStyle[] = RING_STYLES.filter(s => STATIC.includes(s))
/** Styles lumineux par nature (lueur de base). */
const RING_GLOWING: readonly RingStyle[] = ['glow', 'pulse', 'neon_pulse', 'breathe', 'comet', 'halo', 'fire', 'electric', 'radar', 'twin_comet']
/** Styles qui utilisent le nombre de segments. */
export const RING_SEGMENTED: readonly RingStyle[] = ['segmented', 'dashed_spin', 'stripes', 'chase', 'matrix', 'sunburst', 'electric', 'sparkle']
const SHAPE_RADIUS: Record<RingShape, string> = { circle: '9999px', rounded: '30%', squircle: '38%' }
const RAINBOW = [0xff3b30, 0xff9500, 0xffcc00, 0x34c759, 0x007aff, 0xaf52de]

const num = (v: unknown, [min, max]: readonly [number, number]): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : null
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null =>
  (list as readonly unknown[]).includes(v) ? (v as T) : null

/** Anneau reçu nettoyé (garde contre un cache ancien ou hostile) ; null = pas d'anneau. */
export function cleanRing(r: unknown): AvatarRingData | null {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null
  const o = r as Record<string, unknown>
  const colors = Array.isArray(o.colors)
    ? o.colors.filter((c): c is number => Number.isInteger(c) && c >= 0 && c <= 0xffffff).slice(0, RING_COLORS_MAX)
    : []
  if (!colors.length) return null
  const width = Number.isInteger(o.width) ? Math.min(RING_WIDTH_MAX, Math.max(1, o.width as number)) : 3
  const out: AvatarRingData = { colors, width, style: oneOf(RING_STYLES, o.style) ?? 'solid' }
  const fill = oneOf(RING_FILLS, o.fill)
  if (fill && fill !== 'conic') out.fill = fill
  const shape = oneOf(RING_SHAPES, o.shape)
  if (shape && shape !== 'circle') out.shape = shape
  const gap = num(o.gap, [0, RING_GAP_MAX])
  if (gap != null) out.gap = gap
  if (o.direction === 'ccw') out.direction = 'ccw'
  for (const k of Object.keys(RING_RANGES) as RingNumKey[]) {
    const v = num(o[k], RING_RANGES[k])
    if (v != null && v !== RING_DEFAULTS[k]) out[k] = v
  }
  return out
}

/** Anneau affiché : celui du serveur s'il existe, sinon l'anneau global du compte. */
export function pickRing(server: unknown, global: unknown): unknown {
  return cleanRing(server) ? server : cleanRing(global) ? global : undefined
}

/** Valeur d'un réglage numérique (défaut si absent). */
export const ringNum = (r: AvatarRingData, k: RingNumKey) => r[k] ?? RING_DEFAULTS[k]

const hex = (c: number) => '#' + (c >>> 0 & 0xffffff).toString(16).padStart(6, '0')
/** Suffixe alpha « #rrggbbaa » (0-1). */
const alpha = (a: number) => Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')
const d = (x: number) => Math.round(x * 100) / 100

/** Fond (masqué en anneau) d'un style plein. `inner` : début de la bande, en % du rayon. */
function ringBackground(r: AvatarRingData, cs: string[], inner: number): string {
  const a = ringNum(r, 'angle')
  const seg = ringNum(r, 'segments')
  const n = cs.length
  const last = cs[n - 1]
  const conic = (stops: string) => `conic-gradient(from ${a}deg, ${stops})`
  const fill = (list: string[]) => {
    if (list.length === 1) return list[0]
    if (r.fill === 'linear') return `linear-gradient(${a}deg, ${list.join(', ')})`
    if (r.fill === 'radial') {
      // Étalé sur l'épaisseur de l'anneau (le centre est masqué).
      return `radial-gradient(circle closest-side, ${list.map((c, i) => `${c} ${d(inner + ((100 - inner) * i) / (list.length - 1))}%`).join(', ')})`
    }
    return conic([...list, list[0]].join(', '))
  }
  const faint = fill(cs.map(c => c + '40'))
  const step = 360 / seg
  const ring = (stop: (i: number, s: number, e: number) => string) =>
    conic(Array.from({ length: seg }, (_, i) => stop(i, d(i * step), d((i + 1) * step))).join(', '))
  const dash = (ratio: number) => ring((i, s, e) => `${cs[i % n]} ${s}deg ${d(s + (e - s) * ratio)}deg, transparent ${d(s + (e - s) * ratio)}deg ${e}deg`)
  const many = (times: number) => conic([...Array.from({ length: times }, () => cs).flat(), cs[0]].join(', '))
  switch (r.style) {
    case 'comet': return conic(`transparent 0deg, transparent 80deg, ${last}55 200deg, ${cs[0]} 360deg`)
    case 'twin_comet':
      return conic(`transparent 0deg 60deg, ${last}55 140deg, ${cs[0]} 180deg, transparent 180deg 240deg, ${last}55 320deg, ${cs[Math.min(1, n - 1)]} 360deg`)
    case 'radar': return `${conic(`transparent 0deg 250deg, ${cs[0]}22 280deg, ${cs[0]} 360deg`)}, ${faint}`
    case 'orbit': return `${conic(`transparent 0deg 320deg, ${cs[0]} 345deg, transparent 360deg`)}, ${faint}`
    case 'double_orbit':
      return `${conic(`transparent 0deg 140deg, ${cs[0]} 165deg, transparent 180deg 320deg, ${cs[Math.min(1, n - 1)]} 345deg, transparent 360deg`)}, ${faint}`
    case 'segmented': return dash(0.73)
    case 'dashed_spin': return dash(0.55)
    case 'chase': return ring((i, s, e) => `${cs[i % n]}${alpha(0.15 + (0.85 * i) / Math.max(1, seg - 1))} ${s}deg ${d(e - 1)}deg, transparent ${d(e - 1)}deg ${e}deg`)
    case 'matrix': return ring((i, s, e) => `${cs[i % n]}${alpha((((i * 7) % 5) + 1) / 5)} ${s}deg ${d(e - 1.5)}deg, transparent ${d(e - 1.5)}deg ${e}deg`)
    case 'stripes': return ring((i, s, e) => `${n > 1 ? cs[i % n] : cs[0] + (i % 2 ? '55' : '')} ${s}deg ${e}deg`)
    case 'sunburst': return ring((i, s, e) => `${cs[Math.floor(i / 2) % n]}${i % 2 ? '50' : ''} ${s}deg ${e}deg`)
    case 'electric': return `repeating-conic-gradient(from ${a}deg, #ffffffcc 0deg 2deg, transparent 2deg ${d(step)}deg), ${fill(cs)}`
    case 'sparkle': return `repeating-conic-gradient(from ${a}deg, #ffffff 0deg 1deg, transparent 1deg ${d(step)}deg), ${fill(cs)}`
    case 'gradient_spin': return many(2)
    case 'prism': case 'vortex': return many(3)
    default: return fill(cs)
  }
}

/** Ce qu'il faut dessiner pour un anneau nettoyé, autour d'un avatar de `size` px. */
export function ringLook(r: AvatarRingData, size: number) {
  // Épaisseur et écart réduits sur les petits avatars (liste des membres, messages).
  const k = Math.min(1, size / 72)
  const w = Math.max(1, Math.round(r.width * k))
  const gap = r.gap != null ? Math.round(r.gap * k) : Math.max(1, Math.round(w / 2))
  const cs = (r.style === 'rainbow' ? RAINBOW : r.colors).map(hex)
  const border = r.style === 'dashed' || r.style === 'dotted' || r.style === 'double'
  const outer = size / 2 + w + gap
  const background = border ? undefined : ringBackground(r, cs, d(((outer - w) / outer) * 100))
  const glowPct = ringNum(r, 'glow')
  const base = Math.max(2, w) * (r.style === 'halo' ? 2 : 1)
  const glowR = RING_GLOWING.includes(r.style) ? (base * glowPct) / 100 : glowPct > 100 ? (base * (glowPct - 100)) / 100 : 0
  const vars: Record<string, string> = {
    '--ring-speed': String(ringNum(r, 'speed') / 100),
    '--deco-turn': r.direction === 'ccw' ? '-1' : '1',
    '--ring-bright': String(ringNum(r, 'brightness') / 100),
    '--ring-glow-r': `${Math.round(glowR * 10) / 10}px`,
    '--ring-glow-c': glowR > 0 ? cs[0] : 'transparent',
    '--ring-op': String(ringNum(r, 'opacity') / 100),
    '--ring-int': String(ringNum(r, 'intensity') / 100),
  }
  return {
    w, gap, cs, border, borderStyle: r.style, background, vars,
    radius: SHAPE_RADIUS[r.shape ?? 'circle'],
    filtered: glowR > 0 || ringNum(r, 'brightness') !== 100 || r.style === 'breathe',
    animated: RING_ANIMATED.includes(r.style),
    /** Calques en plus : tête de comète (anneau rond), écho de l'onde. */
    head: r.style === 'comet' && (r.shape ?? 'circle') === 'circle',
    echo: r.style === 'ripple',
  }
}
