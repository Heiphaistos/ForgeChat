/**
 * Thèmes ForgeChat : point d'entrée public (catalogue PRESETS, recherche, ré-exports).
 * Module PUR, copié à l'identique dans mobile/src/theme/ avec ses modules voisins
 * (themeModel, themeBase, themeClassic, themeCurated, themeFamilies ; vérifié par
 * client/scripts/themes.test.mjs) : web, bureau et Android partagent les mêmes thèmes.
 *
 * Découpage : themeModel = modèle, couleurs, contraste, validation, constructeurs ;
 * les autres modules = tables de données. Aucun module de données n'importe celui-ci.
 */

import { AMOLED, DARK, LIGHT, ONYX, classicTheme, glassTheme, gradient, toHsl, type ClassicRow, type Curated, type CustomTheme, type Preset, type PresetGroup, type ThemeSpec } from './themeModel.ts'
import { FAMILIES, HUES, familyLabel, hueOfIndex, slug } from './themeFamilies.ts'
import { BASE, baseTheme } from './themeBase.ts'
import { CLASSIC } from './themeClassic.ts'
import { GLASS, GRADIENTS, NATURE, NEON, PASTEL, RETRO, SEASONS } from './themeCurated.ts'
export * from './themeModel.ts'
export { HUES, hueOfIndex, FAMILIES, familyLabel, familyTheme, type Family } from './themeFamilies.ts'

/** Préréglage construit à la première lecture de `spec`. */
function lazy(id: string, group: PresetGroup, label: { fr: string; en: string }, build: () => ThemeSpec, meta: { hue?: number; family?: string } = {}): Preset {
  let spec: ThemeSpec | null = null
  return {
    id,
    group,
    label,
    ...meta,
    get spec() {
      return (spec ??= build())
    },
  }
}

const fromClassic = (group: PresetGroup) => ([id, fr, en, [bg, sidebar, channel, input, hover, text, muted, accent], scheme, x]: ClassicRow): Preset =>
  lazy(id, group, { fr, en }, () => classicTheme(fr, scheme ?? 'dark', [bg, sidebar, channel, bg, input, hover, text, muted, accent], x))
const fromCurated = (group: PresetGroup, build: typeof gradient) => ([id, fr, en, scheme, stops, accent, angle]: Curated): Preset =>
  lazy(id, group, { fr, en }, () => build(fr, scheme, stops, accent, angle))

export const PRESETS: Preset[] = [
  // Les 4 premiers : identifiants historiques, ordre et rendu inchangés (thèmes déjà choisis).
  { id: 'dark', group: 'base', label: { fr: 'Sombre', en: 'Dark' }, spec: DARK },
  { id: 'onyx', group: 'base', label: { fr: 'Plus sombre', en: 'Darker' }, spec: ONYX },
  { id: 'darker', group: 'base', label: { fr: 'AMOLED', en: 'AMOLED' }, spec: AMOLED },
  { id: 'light', group: 'base', label: { fr: 'Clair', en: 'Light' }, spec: LIGHT },
  ...BASE.map(([id, fr, en, scheme, h, s, l, accent, link]): Preset => lazy(id, 'base', { fr, en }, () => baseTheme(fr, scheme, h, s, l, accent, link))),
  ...GRADIENTS.map(fromCurated('gradient', gradient)),
  ...CLASSIC.map(fromClassic('classic')),
  ...FAMILIES.flatMap((f) => HUES.map(([hfr, hen], i): Preset => {
    const label = { fr: familyLabel(f.fr, hfr), en: familyLabel(f.en, hen) }
    return lazy(`${f.id}-${slug(hen)}`, f.group, label, () => f.build(hueOfIndex(i), label.fr), { hue: hueOfIndex(i), family: f.id })
  })),
  ...NATURE.map(fromCurated('nature', gradient)),
  ...SEASONS.map(fromCurated('seasonal', gradient)),
  ...PASTEL.map(fromClassic('pastel')),
  ...NEON.map(fromClassic('neon')),
  ...RETRO.map(fromClassic('retro')),
  ...GLASS.map(fromCurated('glass', glassTheme)),
]

export const DEFAULT_THEME_ID = 'dark'
export const DEFAULT_SPEC = DARK

let index: Map<string, Preset> | null = null
/** Préréglage par identifiant (index construit au premier appel). */
export function findPreset(id: string): Preset | undefined {
  index ??= new Map(PRESETS.map((p) => [p.id, p]))
  return index.get(id)
}

/** Thème `id` parmi les préréglages puis les thèmes perso (inconnu → null). */
export function findTheme(id: string, customs: readonly CustomTheme[] = []): ThemeSpec | null {
  return findPreset(id)?.spec ?? customs.find((c) => c.id === id) ?? null
}

/** Teinte dominante d'un préréglage (celle de la famille, sinon celle de son accent). */
export function presetHue(p: Preset): number {
  return p.hue ?? toHsl(p.spec.colors.accent)[0]
}
