// Polices proposées : celles du système ou embarquées dans l'application (aucun service en ligne).
// Les fichiers @fontsource ne sont téléchargés par le navigateur que si la police est utilisée.
import '@fontsource-variable/inter'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/700.css'
import { nameFontStacks } from '../lib/nameStyle'

export interface FontChoice { id: string; label: string; stack: string }

const BASE_FONTS: readonly FontChoice[] = [
  { id: 'system', label: 'settings.appearance.systemFont', stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  { id: 'inter', label: 'Inter', stack: '"Inter Variable", Inter, sans-serif' },
  { id: 'jetbrains', label: 'JetBrains Mono', stack: '"JetBrains Mono", Consolas, monospace' },
  { id: 'arial', label: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
  { id: 'verdana', label: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
  { id: 'trebuchet', label: 'Trebuchet MS', stack: '"Trebuchet MS", Helvetica, sans-serif' },
  { id: 'tahoma', label: 'Tahoma', stack: 'Tahoma, Geneva, sans-serif' },
  { id: 'georgia', label: 'Georgia', stack: 'Georgia, "Times New Roman", serif' },
  { id: 'consolas', label: 'Consolas', stack: 'Consolas, "Courier New", monospace' },
  // Polices du système (aucun téléchargement) : la suivante de la pile prend le relais si absente.
  { id: 'rounded', label: 'fonts.rounded', stack: 'ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", "Segoe UI", sans-serif' },
  { id: 'serif', label: 'fonts.serif', stack: 'ui-serif, "New York", Cambria, "Times New Roman", serif' },
  { id: 'segoe', label: 'Segoe UI', stack: '"Segoe UI", "Segoe UI Variable", Tahoma, sans-serif' },
  { id: 'helvetica', label: 'Helvetica', stack: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { id: 'calibri', label: 'Calibri', stack: 'Calibri, Carlito, "Segoe UI", sans-serif' },
  { id: 'candara', label: 'Candara', stack: 'Candara, Calibri, "Segoe UI", sans-serif' },
  { id: 'gill', label: 'Gill Sans', stack: '"Gill Sans", "Gill Sans MT", Calibri, sans-serif' },
  { id: 'lucida', label: 'Lucida Grande', stack: '"Lucida Grande", "Lucida Sans Unicode", "Lucida Sans", sans-serif' },
  { id: 'cambria', label: 'Cambria', stack: 'Cambria, Caladea, Georgia, serif' },
  { id: 'palatino', label: 'Palatino', stack: '"Palatino Linotype", Palatino, "Book Antiqua", serif' },
  { id: 'garamond', label: 'Garamond', stack: 'Garamond, "EB Garamond", "Times New Roman", serif' },
  { id: 'courier', label: 'Courier New', stack: '"Courier New", Courier, monospace' },
  { id: 'cascadia', label: 'Cascadia Code', stack: '"Cascadia Code", "Cascadia Mono", Consolas, monospace' },
  { id: 'comic', label: 'Comic Sans MS', stack: '"Comic Sans MS", "Comic Neue", "Chalkboard SE", cursive' },
  { id: 'dyslexic', label: 'fonts.dyslexic', stack: '"OpenDyslexic", "Lexend", Verdana, sans-serif' },
]

/**
 * Polices proposées pour toute l'appli : celles ci-dessus, puis les polices du pseudo qui
 * changent de famille (lib/nameStyle.ts, dont les six polices OFL embarquées « FC … »),
 * sans doublon de pile. Le réglage stocke la pile (user_settings.font_family, 100 caractères).
 */
export const FONTS: readonly FontChoice[] = [
  ...BASE_FONTS,
  ...nameFontStacks()
    .filter(n => !BASE_FONTS.some(b => b.stack === n.stack))
    .map(n => ({ id: `name-${n.id}`, label: `profileId.font.${n.id}`, stack: n.stack })),
]

/**
 * Réglage font_family du compte → pile CSS connue. Accepte l'identifiant, l'ancienne valeur
 * (pile complète, ou « Inter » par défaut côté serveur) ; toute autre valeur → police système.
 */
export function fontStack(value: unknown): string {
  if (typeof value !== 'string') return FONTS[0].stack
  const v = value.trim().toLowerCase()
  const f = FONTS.find(x => x.id === v || x.stack.toLowerCase() === v || x.label.toLowerCase() === v)
    ?? FONTS.find(x => v.startsWith(x.label.toLowerCase()) || v.startsWith(`"${x.label.toLowerCase()}"`))
  return (f ?? FONTS[0]).stack
}

export const fontId = (value: unknown) => FONTS.find(f => f.stack === fontStack(value))?.id ?? 'system'
