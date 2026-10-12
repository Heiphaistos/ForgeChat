// Import et export de thèmes sur le téléphone (audit 2026-10-12, amélioration n° 42) : même code
// texte que le web (FCTHEME1:…, theme/themeCore.ts), validé par sanitizeTheme à l'import. Le thème
// importé rejoint les thèmes du compte (/user/theme-studio) : web, bureau et téléphones le voient.
import { decodeTheme, encodeTheme, type CustomTheme, type ThemeSpec } from '@/theme/themeCore'

export const MAX_CUSTOMS = 30

/** Identifiant de thème perso au format du serveur (`c-…`, minuscules). */
export function newCustomId(now = Date.now(), rnd = Math.random()): string {
  return `c-${now.toString(36)}${Math.floor(rnd * 36 ** 4).toString(36).padStart(4, '0')}`.slice(0, 40)
}

/** Studio du compte avec le thème importé ajouté (null : code illisible ou trop de thèmes). */
export function studioWithImport(studio: Record<string, unknown> | null | undefined, customs: CustomTheme[], code: string): { studio: Record<string, unknown>; theme: CustomTheme } | null {
  const spec = decodeTheme(code)
  if (!spec || customs.length >= MAX_CUSTOMS) return null
  const theme: CustomTheme = { ...spec, id: newCustomId() }
  return { studio: { ...(studio ?? {}), customs: [...customs, theme] }, theme }
}

export const shareCode = (spec: ThemeSpec) => encodeTheme(spec)
