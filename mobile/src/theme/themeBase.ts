/**
 * Thèmes « de base » supplémentaires (données) : surfaces unies façon Discord, sombres et clairs.
 * Chaque ligne = teinte, saturation et luminosité du fond ; l'empilement des surfaces suit
 * celui de Sombre / Clair (barre, salons, discussion, saisie, survol). Contraste AA par fixContrast.
 */
import { hsl, tint, type Scheme, type ThemeSpec } from './themeModel.ts'

/** Écarts de luminosité des surfaces (fond, barre, salons, discussion, saisie, survol). */
const STACK: Record<Scheme, number[]> = { dark: [0, 2, 4, 11, 15, 7], light: [0, -6, -3, 5, -6, -10] }

export function baseTheme(name: string, scheme: Scheme, h: number, s: number, l: number, accent: string, link?: string): ThemeSpec {
  const dark = scheme === 'dark'
  const text = dark ? hsl(h, Math.min(s, 20), 90) : hsl(h, Math.min(s, 30), 10)
  const muted = dark ? hsl(h, Math.min(s, 15), 68) : hsl(h, Math.min(s, 15), 35)
  return tint(name, scheme, h, s, STACK[scheme].map((d) => l + d), text, muted, accent, link ? { link } : {})
}

type BaseRow = [id: string, fr: string, en: string, scheme: Scheme, h: number, s: number, l: number, accent: string, link?: string]

export const BASE: BaseRow[] = [
  ['b-slate', 'Ardoise', 'Slate', 'dark', 215, 18, 12, '#5b8def'],
  ['b-graphite', 'Graphite', 'Graphite', 'dark', 220, 6, 11, '#8c9aff'],
  ['b-anthracite', 'Anthracite', 'Anthracite', 'dark', 200, 8, 9, '#3fa7d6'],
  ['b-charcoal', 'Charbon', 'Charcoal', 'dark', 30, 5, 7, '#f0a04b'],
  ['b-steel', 'Gris acier', 'Steel grey', 'dark', 210, 12, 15, '#4f9fd9'],
  ['b-warm-grey', 'Gris chaud', 'Warm grey', 'dark', 30, 8, 13, '#d9825b'],
  ['b-taupe', 'Taupe', 'Taupe', 'dark', 25, 12, 14, '#c49a6c'],
  ['b-night-blue', 'Bleu nuit', 'Night blue', 'dark', 225, 45, 10, '#6c8cff'],
  ['b-navy', 'Marine', 'Navy', 'dark', 215, 60, 11, '#4fb3ff'],
  ['b-midnight', 'Minuit', 'Midnight', 'dark', 240, 30, 8, '#8a7dff'],
  ['b-petrol', 'Bleu pétrole', 'Petrol blue', 'dark', 192, 45, 11, '#2ec4c4'],
  ['b-forest', 'Vert forêt', 'Forest green', 'dark', 140, 25, 10, '#4cc276'],
  ['b-dark-emerald', 'Émeraude sombre', 'Dark emerald', 'dark', 158, 40, 9, '#2fd59a'],
  ['b-fir', 'Sapin', 'Fir', 'dark', 165, 25, 12, '#7ccf8a'],
  ['b-olive', 'Olive', 'Olive', 'dark', 70, 18, 11, '#b5c74a'],
  ['b-burgundy', 'Bordeaux', 'Burgundy', 'dark', 345, 35, 10, '#e0607e'],
  ['b-garnet', 'Grenat', 'Garnet', 'dark', 355, 45, 9, '#ff5c5c'],
  ['b-plum', 'Prune', 'Plum', 'dark', 300, 20, 11, '#d77fd0'],
  ['b-violet', 'Violet', 'Violet', 'dark', 270, 30, 12, '#a57bff'],
  ['b-eggplant', 'Aubergine', 'Eggplant', 'dark', 290, 35, 9, '#c86bfa'],
  ['b-indigo', 'Indigo', 'Indigo', 'dark', 250, 40, 12, '#7b7bff'],
  ['b-coffee', 'Café', 'Coffee', 'dark', 28, 25, 10, '#d89a5a'],
  ['b-chocolate', 'Chocolat', 'Chocolate', 'dark', 15, 30, 9, '#e07a4a'],
  ['b-dark-sepia', 'Sépia sombre', 'Dark sepia', 'dark', 35, 30, 11, '#d4a259'],
  ['b-solarized-dark', 'Solarisé sombre', 'Solarized dark', 'dark', 192, 100, 10, '#268bd2', '#2aa198'],
  ['b-ink', 'Encre', 'Ink', 'dark', 230, 25, 7, '#4d8dff'],
  ['b-sepia', 'Sépia', 'Sepia', 'light', 38, 45, 92, '#8b5a2b'],
  ['b-sand', 'Sable', 'Sand', 'light', 40, 40, 90, '#a0612a'],
  ['b-ivory', 'Ivoire', 'Ivory', 'light', 50, 60, 95, '#8a6d1f'],
  ['b-cream', 'Crème', 'Cream', 'light', 42, 70, 94, '#b0571c'],
  ['b-paper', 'Papier', 'Paper', 'light', 45, 20, 96, '#3d5a99'],
  ['b-linen', 'Lin', 'Linen', 'light', 30, 35, 93, '#9a5b3c'],
  ['b-pearl', 'Gris perle', 'Pearl grey', 'light', 220, 10, 94, '#4a6fa5'],
  ['b-glacier', 'Bleu glacier clair', 'Light glacier blue', 'light', 200, 60, 95, '#1d72b8'],
  ['b-mint', 'Menthe claire', 'Light mint', 'light', 150, 45, 94, '#1f8a5b'],
  ['b-lavender', 'Lavande claire', 'Light lavender', 'light', 265, 55, 95, '#6b4bc4'],
  ['b-powder-pink', 'Rose poudré clair', 'Light powder pink', 'light', 345, 55, 95, '#b03a68'],
  ['b-peach', 'Pêche claire', 'Light peach', 'light', 22, 80, 94, '#c0501e'],
  ['b-solarized-light', 'Solarisé clair', 'Solarized light', 'light', 44, 87, 94, '#268bd2', '#2aa198'],
  ['b-light-slate', 'Ardoise claire', 'Light slate', 'light', 215, 20, 94, '#3b6fd4'],
  ['b-light-taupe', 'Taupe clair', 'Light taupe', 'light', 30, 15, 92, '#8a5e3c'],
  ['b-sage', 'Sauge claire', 'Light sage', 'light', 110, 20, 93, '#4f7a3a'],
  ['b-sky', 'Ciel clair', 'Light sky', 'light', 210, 70, 96, '#2563c9'],
  ['b-silver', 'Argent', 'Silver', 'light', 210, 5, 93, '#3a7bd5'],
]
