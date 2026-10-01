/**
 * Statuts de présence — mêmes couleurs et libellés que le client web (tailwind fc-green,
 * fc-yellow, fc-red, fc-muted ; UserPanel / UserProfileModal).
 *
 * Valeurs : le web écrit « idle » (PATCH /users/me) ; le mobile passe par PATCH /user/status,
 * qui n'accepte que « away » (et diffuse « invisible » comme hors ligne). Les deux s'affichent
 * « Absent ».
 */

export type StatusKey = 'online' | 'away' | 'dnd' | 'invisible' | 'offline'

// Hors ligne / invisible : #80848e au lieu du #72767d du web, qui n'atteint pas 3:1 (WCAG 1.4.11,
// composant graphique) sur le fond principal #313338 (2,77:1). Testé dans __tests__/status.test.ts.
export const STATUS_COLORS = {
  online: '#3ba55c',
  away: '#faa81a',
  dnd: '#ed4245',
  invisible: '#80848e',
  offline: '#80848e',
} as const satisfies Record<StatusKey, string>

const LABELS: Record<StatusKey, string> = {
  online: 'En ligne',
  away: 'Absent',
  dnd: 'Ne pas déranger',
  invisible: 'Invisible',
  offline: 'Hors ligne',
}

/** Statuts qu'on peut choisir (même ordre que le web). */
export const SELECTABLE_STATUSES: readonly StatusKey[] = ['online', 'away', 'dnd', 'invisible']

/** Normalise une valeur serveur (idle/away, inconnue → hors ligne). */
export function normalizeStatus(raw: string | null | undefined): StatusKey {
  if (raw === 'idle' || raw === 'away') return 'away'
  if (raw === 'online' || raw === 'dnd' || raw === 'invisible') return raw
  return 'offline'
}

export const statusColor = (raw: string | null | undefined) => STATUS_COLORS[normalizeStatus(raw)]
export const statusLabel = (raw: string | null | undefined) => LABELS[normalizeStatus(raw)]
/** Hors ligne / invisible : anneau creux (en plus de la couleur, pour ne pas dépendre que d'elle). */
export const statusHollow = (raw: string | null | undefined) => {
  const s = normalizeStatus(raw)
  return s === 'offline' || s === 'invisible'
}

// ─── Contraste (WCAG 2.1) ───────────────────────────────────────────────────

function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!
}

/** Rapport de contraste entre deux couleurs #rrggbb (1 à 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
