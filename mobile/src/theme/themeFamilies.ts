/** Familles générées (teinte × famille). */
import { grad, hsl, mix, solid, tint, type PresetGroup, type ThemeSpec } from './themeModel.ts'

// ─── Familles générées (teinte × famille) ───────────────────────────────────
// Chaque famille est une recette (surfaces, texte, accent) appliquée à 48 teintes nommées :
// plus d'un millier de thèmes à partir d'une table compacte. Le contraste AA est garanti par
// fixContrast, comme pour les thèmes écrits à la main.

/** 48 teintes (pas de 7,5°) : nom français, nom anglais (l'identifiant en dérive). */
export const HUES: [fr: string, en: string][] = [
  ['Rubis', 'Ruby'], ['Vermillon', 'Vermilion'], ['Corail', 'Coral'], ['Cuivre', 'Copper'],
  ['Mandarine', 'Tangerine'], ['Abricot', 'Apricot'], ['Ambre', 'Amber'], ['Safran', 'Saffron'],
  ['Citron', 'Lemon'], ['Soufre', 'Sulfur'], ['Olive', 'Olive'], ['Citron vert', 'Lime'],
  ['Chartreuse', 'Chartreuse'], ['Pistache', 'Pistachio'], ['Prairie', 'Meadow'], ['Fougère', 'Fern'],
  ['Trèfle', 'Clover'], ['Basilic', 'Basil'], ['Émeraude', 'Emerald'], ['Jade', 'Jade'],
  ['Menthe', 'Mint'], ['Malachite', 'Malachite'], ['Aigue-marine', 'Aquamarine'], ['Turquoise', 'Turquoise'],
  ['Cyan', 'Cyan'], ['Lagon', 'Lagoon'], ['Azur', 'Azure'], ['Céruléen', 'Cerulean'],
  ['Ciel', 'Sky'], ['Acier', 'Steel'], ['Saphir', 'Sapphire'], ['Cobalt', 'Cobalt'],
  ['Bleuet', 'Cornflower'], ['Outremer', 'Ultramarine'], ['Iris', 'Iris'], ['Indigo', 'Indigo'],
  ['Violet', 'Violet'], ['Améthyste', 'Amethyst'], ['Pourpre', 'Purple'], ['Orchidée', 'Orchid'],
  ['Magenta', 'Magenta'], ['Prune', 'Plum'], ['Fuchsia', 'Fuchsia'], ['Pivoine', 'Peony'],
  ['Rose', 'Pink'], ['Framboise', 'Raspberry'], ['Cerise', 'Cherry'], ['Carmin', 'Carmine'],
]
export const hueOfIndex = (i: number) => i * 7.5

export interface Family {
  /** Préfixe des identifiants (`<id>-<teinte>`). */
  id: string
  group: PresetGroup
  /** Libellés : {h} = nom de la teinte. */
  fr: string
  en: string
  build: (h: number, name: string) => ThemeSpec
}

const BLACK = '#000000'
const WHITE = '#ffffff'

export const FAMILIES: Family[] = [
  { id: 'tn', group: 'tinted', fr: '{h} sombre', en: 'Dark {h}', build: (h, n) =>
    tint(n, 'dark', h, 14, [10, 8, 12, 17, 22, 20], hsl(h, 15, 91), hsl(h, 10, 68), hsl(h, 70, 62), { link: hsl(h + 20, 80, 72), border: hsl(h, 12, 24) }) },
  { id: 'dm', group: 'tinted', fr: '{h} tamisé', en: 'Dim {h}', build: (h, n) =>
    tint(n, 'dark', h, 10, [20, 17, 22, 25, 31, 29], hsl(h, 12, 93), hsl(h, 10, 76), hsl(h, 65, 66), { link: hsl(h + 20, 75, 78), border: hsl(h, 10, 33) }) },
  { id: 'nt', group: 'tinted', fr: 'Nuit {h}', en: '{h} night', build: (h, n) =>
    tint(n, 'dark', h, 40, [6, 4, 8, 10, 15, 13], hsl(h, 30, 90), hsl(h, 25, 70), hsl(h, 85, 65), { link: hsl(h + 25, 90, 74), border: hsl(h, 35, 18) }) },
  { id: 'am', group: 'amoled', fr: 'AMOLED {h}', en: 'AMOLED {h}', build: (h, n) => ({
    ...solid(n, 'dark', [BLACK, BLACK, BLACK, BLACK, BLACK, hsl(h, 30, 6), hsl(h, 10, 95), hsl(h, 10, 70), hsl(h, 85, 60)], { link: hsl(h, 90, 72), border: hsl(h, 45, 20) }),
    outline: true,
  }) },
  { id: 'ag', group: 'amoled', fr: 'AMOLED lueur {h}', en: '{h} AMOLED glow', build: (h, n) => ({
    ...solid(n, 'dark', [BLACK, BLACK, BLACK, BLACK, BLACK, hsl(h, 40, 6), hsl(h, 20, 95), hsl(h, 40, 72), hsl(h, 95, 60)], { link: hsl(h, 95, 72), mention: hsl(h, 95, 66), border: hsl(h, 80, 35) }),
    outline: true,
    accent2: hsl(h + 40, 90, 60),
  }) },
  { id: 'lt', group: 'light', fr: '{h} clair', en: 'Light {h}', build: (h, n) =>
    tint(n, 'light', h, 22, [95, 90, 93, 99, 89, 85], hsl(h, 30, 9), hsl(h, 12, 36), hsl(h, 70, 42), { link: hsl(h, 80, 34), border: hsl(h, 18, 82) }) },
  { id: 'pp', group: 'light', fr: 'Papier {h}', en: '{h} paper', build: (h, n) => {
    const paper = (l: number) => mix(hsl(40, 35, l), hsl(h, 50, l), 0.25)
    return { ...solid(n, 'light', [paper(93), paper(88), paper(91), paper(97), paper(86), paper(82), hsl(30, 25, 12), hsl(30, 12, 36), hsl(h, 65, 38)], { border: paper(80) }), radius: 0.75 }
  } },
  { id: 'ps', group: 'pastel', fr: 'Pastel {h}', en: 'Pastel {h}', build: (h, n) =>
    ({ ...tint(n, 'light', h, 60, [92, 88, 90, 96, 85, 82], hsl(h, 35, 14), hsl(h, 20, 34), hsl(h, 55, 45), { link: hsl(h, 70, 32), border: hsl(h, 40, 80) }), radius: 1.5 }) },
  { id: 'pn', group: 'pastel', fr: 'Pastel nocturne {h}', en: 'Pastel night {h}', build: (h, n) =>
    ({ ...tint(n, 'dark', h, 18, [15, 12, 17, 20, 26, 24], hsl(h, 40, 92), hsl(h, 25, 76), hsl(h, 75, 80), { link: hsl(h + 30, 80, 82), border: hsl(h, 20, 28) }), radius: 1.5 }) },
  { id: 'ne', group: 'neon', fr: 'Néon {h}', en: 'Neon {h}', build: (h, n) => ({
    ...tint(n, 'dark', h, 45, [5, 3, 6, 8, 12, 11], hsl(h, 30, 92), hsl(h, 30, 70), hsl(h, 100, 58), { link: hsl(h, 100, 70), border: hsl(h, 80, 28) }),
    accent2: hsl(h + 60, 100, 60), pattern: 'grid', patternOpacity: 0.06,
  }) },
  { id: 'sw', group: 'neon', fr: 'Synthwave {h}', en: '{h} synthwave', build: (h, n) =>
    grad(n, 'dark', [hsl(h, 60, 8), hsl(h + 40, 65, 22), hsl(h + 80, 70, 32)], hsl(h + 40, 100, 66), 180, { accent2: hsl(h + 80, 100, 62), pattern: 'grid', patternOpacity: 0.1 }) },
  { id: 'rt', group: 'retro', fr: 'Rétro {h}', en: 'Retro {h}', build: (h, n) => {
    const w = (l: number) => mix(hsl(30, 24, l), hsl(h, 24, l), 0.35)
    return { ...solid(n, 'dark', [w(13), w(10), w(15), w(18), w(23), w(21), hsl(40, 45, 86), hsl(35, 20, 66), hsl(h, 60, 58)], { border: w(26) }), radius: 0.5 }
  } },
  { id: 'tm', group: 'retro', fr: 'Terminal {h}', en: '{h} terminal', build: (h, n) => ({
    ...tint(n, 'dark', h, 30, [3, 2, 4, 5, 8, 9], hsl(h, 90, 62), hsl(h, 55, 52), hsl(h, 100, 55), { link: hsl(h, 100, 72), border: hsl(h, 60, 18) }),
    radius: 0.25, outline: true, pattern: 'lines', patternOpacity: 0.07,
  }) },
  { id: 'vt', group: 'retro', fr: 'Vintage {h}', en: 'Vintage {h}', build: (h, n) => {
    const sepia = (l: number) => mix(hsl(38, 40, l), hsl(h, 30, l), 0.3)
    return { ...solid(n, 'light', [sepia(88), sepia(83), sepia(86), sepia(92), sepia(80), sepia(77), hsl(25, 35, 13), hsl(25, 18, 32), hsl(h, 55, 36)], { border: sepia(72) }), radius: 0.5 }
  } },
  { id: 'ir', group: 'iridescent', fr: '{h} irisé', en: 'Iridescent {h}', build: (h, n) =>
    grad(n, 'dark', [hsl(h, 60, 20), hsl(h + 40, 60, 24), hsl(h + 80, 60, 28)], hsl(h + 40, 90, 70), 135, { accent2: hsl(h + 80, 90, 68) }) },
  { id: 'nc', group: 'iridescent', fr: 'Nacre {h}', en: '{h} pearl', build: (h, n) =>
    grad(n, 'light', [hsl(h, 70, 90), hsl(h + 50, 70, 88), hsl(h + 100, 70, 91)], hsl(h, 60, 38), 120, { accent2: hsl(h + 50, 60, 40) }) },
  { id: 'au', group: 'iridescent', fr: 'Aurore {h}', en: '{h} aurora', build: (h, n) =>
    grad(n, 'dark', [hsl(h, 55, 9), hsl(h + 150, 60, 22), hsl(h + 60, 55, 17)], hsl(h + 150, 85, 62), 160) },
  { id: 'du', group: 'iridescent', fr: 'Duo {h}', en: '{h} duotone', build: (h, n) =>
    grad(n, 'dark', [hsl(h, 55, 18), hsl(h + 180, 55, 22)], hsl(h + 180, 85, 68), 135, { accent2: hsl(h, 85, 66) }) },
  { id: 'vr', group: 'glass', fr: 'Verre {h}', en: '{h} glass', build: (h, n) =>
    grad(n, 'dark', [hsl(h, 55, 28), hsl(h + 25, 60, 34)], hsl(h, 90, 74), 135, { opacity: 0.35, blur: 28, radius: 1.25, pattern: 'dots', patternOpacity: 0.05 }) },
  { id: 'gv', group: 'glass', fr: 'Givre {h}', en: '{h} frost', build: (h, n) =>
    grad(n, 'light', [hsl(h, 60, 80), hsl(h + 25, 60, 86)], hsl(h, 70, 36), 135, { opacity: 0.45, blur: 24, radius: 1.25 }) },
  { id: 'hc', group: 'contrast', fr: '{h} contraste fort', en: '{h} high contrast', build: (h, n) => ({
    ...solid(n, 'dark', [BLACK, BLACK, BLACK, BLACK, hsl(h, 20, 7), hsl(h, 25, 14), WHITE, '#e6e6e6', hsl(h, 100, 65)], { link: hsl(h, 100, 78), mention: hsl(h, 100, 72), border: hsl(h, 100, 70) }),
    outline: true,
  }) },
  { id: 'hl', group: 'contrast', fr: '{h} contraste clair', en: '{h} high contrast light', build: (h, n) => ({
    ...solid(n, 'light', [WHITE, WHITE, WHITE, WHITE, hsl(h, 20, 96), hsl(h, 30, 90), BLACK, '#1f1f1f', hsl(h, 100, 28)], { link: hsl(h, 100, 24), mention: hsl(h, 100, 30), border: hsl(h, 100, 25) }),
    outline: true,
  }) },
  { id: 'ab', group: 'gradient', fr: 'Aube {h}', en: '{h} dawn', build: (h, n) =>
    grad(n, 'light', [hsl(h, 75, 90), hsl(h + 30, 80, 86), hsl(h - 30, 70, 93)], hsl(h, 65, 38), 180) },
  { id: 'cr', group: 'gradient', fr: 'Crépuscule {h}', en: '{h} dusk', build: (h, n) =>
    grad(n, 'dark', [hsl(h, 50, 6), hsl(h + 20, 55, 18), hsl(h + 40, 60, 30)], hsl(h + 40, 90, 68), 180) },
]

export const slug = (en: string) => en.toLowerCase().replace(/[^a-z0-9]+/g, '-')

/** Libellé d'une famille pour une teinte : « {h} sombre » → « Rubis sombre », « Nuit {h} » → « Nuit rubis ». */
export function familyLabel(tpl: string, hueName: string): string {
  if (tpl.startsWith('{h}')) return tpl.replace('{h}', hueName)
  return tpl.replace('{h}', hueName.charAt(0).toLowerCase() + hueName.slice(1))
}

/** Thème d'une famille pour une teinte libre (éditeur : « générer à partir d'une couleur »). */
export function familyTheme(familyId: string, hue: number, name: string): ThemeSpec | null {
  const f = FAMILIES.find((x) => x.id === familyId)
  return f ? f.build(hue, name) : null
}
