// Style des en-têtes de catégorie choisi sur le web ou le bureau (Apparence → Disposition, ou
// « Apparence de ce serveur »), lu dans /user/theme-studio et traduit en styles natifs.
// Même format que client/src/theme/serverLook.ts.
import type { TextStyle, ViewStyle } from 'react-native'
import { colors } from '@/theme'

const SHAPES = ['auto', 'plain', 'outline', 'pill', 'card', 'bar', 'underline'] as const
type Shape = (typeof SHAPES)[number]
export interface CategoryLook { shape: Shape; color: string | null; uppercase: boolean }

const HEX = /^#[0-9a-f]{6}$/i
const DEFAULT: CategoryLook = { shape: 'auto', color: null, uppercase: true }

function sanitize(raw: unknown): CategoryLook | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>
  return {
    shape: SHAPES.includes(v.shape as Shape) ? (v.shape as Shape) : 'auto',
    color: typeof v.color === 'string' && HEX.test(v.color) ? v.color : null,
    uppercase: typeof v.uppercase === 'boolean' ? v.uppercase : true,
  }
}

/** Style du serveur s'il en a un, sinon le style général, sinon celui par défaut. */
export function categoryLookFor(studio: unknown, serverId: string): CategoryLook {
  const s = studio && typeof studio === 'object' ? (studio as Record<string, unknown>) : {}
  const servers = s.servers && typeof s.servers === 'object' ? (s.servers as Record<string, { category?: unknown }>) : {}
  return sanitize(servers[serverId.toLowerCase()]?.category) ?? sanitize(s.category) ?? DEFAULT
}

/** Styles de la ligne et du titre (alpha en suffixe hexadécimal : 29 ≈ 16 %, 2e ≈ 18 %, b3 ≈ 70 %). */
export function categoryStyles(look: CategoryLook): { row: ViewStyle; text: TextStyle } {
  const c = look.color ?? colors.primary
  const box: ViewStyle = { marginHorizontal: 8, paddingVertical: 6, paddingHorizontal: 8 }
  switch (look.shape) {
    case 'outline': return { row: { ...box, borderWidth: 1, borderColor: look.color ?? colors.border, borderRadius: 6 }, text: {} }
    case 'pill': return { row: { ...box, borderRadius: 999, backgroundColor: `${c}29` }, text: { color: c } }
    case 'card': return { row: { ...box, borderRadius: 8, backgroundColor: colors.bgHover, borderWidth: 1, borderColor: look.color ? `${c}99` : colors.border, elevation: 2 }, text: { color: colors.text } }
    case 'bar': return { row: { ...box, borderLeftWidth: 3, borderLeftColor: c, borderTopRightRadius: 6, borderBottomRightRadius: 6, backgroundColor: `${c}2e` }, text: { color: c } }
    case 'underline': return { row: { ...box, borderBottomWidth: 1, borderBottomColor: `${c}b3` }, text: { color: c } }
    default: return { row: {}, text: {} }
  }
}
