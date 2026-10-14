/**
 * Anneau d'avatar v2 — logique pure (aucun import React Native : testée par jest).
 * Même contrat que server/src/models/avatar_ring.rs et client/src/lib/avatarRing.ts :
 * listes dans le même ordre, mêmes bornes. Utilisé pour l'anneau global (users.avatar_ring) et
 * pour celui du profil de serveur (server_members.server_avatar_ring). Rétro-compatible v1
 * (≤ 3 couleurs, épaisseur ≤ 8, 14 styles).
 */
export const RING_STYLES = [
  'solid', 'dashed', 'dotted', 'double', 'glow', 'spin', 'pulse',
  'gradient_spin', 'rainbow', 'dashed_spin', 'neon_pulse', 'comet', 'segmented', 'breathe',
  'orbit', 'double_orbit', 'aurora', 'fire', 'electric', 'wave', 'heartbeat', 'sparkle', 'radar',
  'prism', 'chase', 'ripple', 'glitch', 'twin_comet', 'stripes', 'flicker', 'halo', 'sunburst', 'vortex', 'matrix',
] as const
export type RingStyle = (typeof RING_STYLES)[number]
export const RING_FILLS = ['conic', 'linear', 'radial'] as const
export type RingFill = (typeof RING_FILLS)[number]
export const RING_SHAPES = ['circle', 'rounded', 'squircle'] as const
export type RingShape = (typeof RING_SHAPES)[number]
export const RING_COLORS_MAX = 8
export const RING_WIDTH_MAX = 12
export const RING_GAP_MAX = 8
export const RING_SEGMENTS_RANGE = [2, 24] as const
export const RING_MAX_BYTES = 512
/** Bornes des réglages numériques : [min, max, défaut]. */
export const RING_RANGES = {
  width: [1, RING_WIDTH_MAX, 3],
  angle: [0, 360, 0],
  gap: [0, RING_GAP_MAX, 0],
  segments: [RING_SEGMENTS_RANGE[0], RING_SEGMENTS_RANGE[1], 12],
  speed: [25, 400, 100],
  brightness: [50, 200, 100],
  glow: [0, 300, 100],
  opacity: [20, 100, 100],
  intensity: [25, 200, 100],
} as const
export type RingNumKey = keyof typeof RING_RANGES

/** Styles figés (tous les autres bougent). */
const STATIC: readonly RingStyle[] = ['solid', 'dashed', 'dotted', 'double', 'glow', 'segmented', 'stripes', 'halo']
export const RING_ANIMATED: readonly RingStyle[] = RING_STYLES.filter((s) => !STATIC.includes(s))
/** Styles lumineux par nature (lueur de base même à 100 %). */
export const RING_GLOWING: readonly RingStyle[] = [
  'glow', 'pulse', 'neon_pulse', 'breathe', 'comet', 'aurora', 'fire', 'electric', 'heartbeat', 'prism',
  'twin_comet', 'flicker', 'halo', 'sunburst', 'radar', 'ripple',
]
/** Styles qui découpent l'anneau en `segments`. */
export const RING_SEGMENTED: readonly RingStyle[] = ['segmented', 'dashed_spin', 'stripes', 'chase', 'matrix']

export interface AvatarRingData {
  colors: number[]
  width: number
  style: RingStyle
  fill?: RingFill
  angle?: number
  shape?: RingShape
  /** Absent = écart automatique. */
  gap?: number
  segments?: number
  speed?: number
  direction?: 'cw' | 'ccw'
  brightness?: number
  glow?: number
  opacity?: number
  intensity?: number
}

/** Entier borné, ou null si la valeur n'est pas un nombre fini. */
function int(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : null
}
const pick = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
  (list as readonly unknown[]).includes(v) ? (v as T) : undefined

/**
 * Anneau reçu (serveur, cache ancien, saisie) nettoyé ; null = pas d'anneau. Ne garde que des
 * entiers 0xRRGGBB et des nombres bornés ; les valeurs par défaut sont omises (forme canonique,
 * envoyée telle quelle dans le PATCH du profil).
 */
export function cleanRing(r: unknown): AvatarRingData | null {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null
  const o = r as Record<string, unknown>
  const colors = Array.isArray(o.colors)
    ? o.colors.slice(0, 64).filter((c): c is number => Number.isInteger(c) && (c as number) >= 0 && (c as number) <= 0xffffff).slice(0, RING_COLORS_MAX)
    : []
  if (!colors.length) return null
  const out: AvatarRingData = {
    colors,
    width: Number.isInteger(o.width) ? (int(o.width, 1, RING_WIDTH_MAX) as number) : 3,
    style: pick(RING_STYLES, o.style) ?? 'solid',
  }
  const fill = pick(RING_FILLS, o.fill)
  if (fill && fill !== 'conic') out.fill = fill
  const shape = pick(RING_SHAPES, o.shape)
  if (shape && shape !== 'circle') out.shape = shape
  if (o.direction === 'ccw') out.direction = 'ccw'
  const gap = int(o.gap, 0, RING_GAP_MAX)
  if (gap != null) out.gap = gap
  for (const k of ['angle', 'segments', 'speed', 'brightness', 'glow', 'opacity', 'intensity'] as const) {
    const [min, max, def] = RING_RANGES[k]
    const n = int(o[k], min, max)
    if (n != null && n !== def) out[k] = n
  }
  return out
}

/**
 * Anneau affiché pour un membre : celui de son profil de serveur, sinon son anneau global
 * (`avatar_ring` renvoyé avec les membres, ou `fallback` quand le membre n'est pas chargé).
 */
export function effectiveRing(member?: { server_avatar_ring?: unknown; avatar_ring?: unknown } | null, fallback?: unknown): AvatarRingData | null {
  return cleanRing(member?.server_avatar_ring) ?? cleanRing(member?.avatar_ring) ?? cleanRing(fallback)
}

/** Valeur d'un réglage numérique, défaut compris (gap auto => null). */
export function ringNum(r: AvatarRingData, k: Exclude<RingNumKey, 'gap'>): number {
  return k === 'width' ? r.width : (r[k] ?? RING_RANGES[k][2])
}

export const RAINBOW = [0xff3b30, 0xff9500, 0xffcc00, 0x34c759, 0x007aff, 0xaf52de]

/** Couleurs dessinées : arc-en-ciel pour « rainbow », et pour « prism » s'il n'y a qu'une couleur. */
export const ringPalette = (r: AvatarRingData): number[] =>
  r.style === 'rainbow' || (r.style === 'prism' && r.colors.length < 2) ? RAINBOW : r.colors

/** Durée d'un cycle d'animation (ms) à la vitesse choisie. */
export function ringDuration(r: AvatarRingData): number {
  const base: Partial<Record<RingStyle, number>> = {
    comet: 1800, twin_comet: 2200, gradient_spin: 2600, rainbow: 6000, prism: 8000, radar: 2400, orbit: 3000, double_orbit: 3600,
    pulse: 2400, neon_pulse: 2400, breathe: 3200, heartbeat: 1600, flicker: 1400, glitch: 1800, electric: 900, fire: 1200,
    sparkle: 2400, ripple: 2000, wave: 2400, aurora: 7000, sunburst: 9000, vortex: 3000, matrix: 2200, chase: 2400,
  }
  return Math.round(((base[r.style] ?? 4000) * 100) / (r.speed ?? 100))
}

/** Écart (px) entre le bord de l'avatar et le bord intérieur de l'anneau. */
export function ringGap(r: AvatarRingData, w: number, scale: number): number {
  return r.gap != null ? Math.round(r.gap * scale) : Math.max(1, Math.round(w / 2))
}

/** Rayon des coins selon la forme, pour une boîte de `box` px de côté. */
export const shapeRadius = (shape: RingShape | undefined, box: number) =>
  shape === 'rounded' ? box * 0.22 : shape === 'squircle' ? box * 0.36 : box / 2

/**
 * Couleurs des quatre côtés d'une bordure (dégradé « linear » approché) : premier en haut,
 * dernier en bas, couleurs du milieu sur les flancs ; l'angle fait tourner le calque.
 */
export function linearSides(cs: string[]): [string, string, string, string] {
  const first = cs[0] ?? '#ffffff'
  const last = cs[cs.length - 1] ?? first
  const mid = cs[Math.floor((cs.length - 1) / 2)] ?? first
  const mid2 = cs[Math.ceil((cs.length - 1) / 2)] ?? mid
  return [first, mid2, last, mid]
}
