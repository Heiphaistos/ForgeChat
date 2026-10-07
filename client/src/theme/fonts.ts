// Polices proposées : celles du système ou embarquées dans l'application (aucun service en ligne).
// Les fichiers @fontsource ne sont téléchargés par le navigateur que si la police est utilisée.
import '@fontsource-variable/inter'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/700.css'

export const FONTS = [
  { id: 'system', label: 'settings.appearance.systemFont', stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  { id: 'inter', label: 'Inter', stack: '"Inter Variable", Inter, sans-serif' },
  { id: 'jetbrains', label: 'JetBrains Mono', stack: '"JetBrains Mono", Consolas, monospace' },
  { id: 'arial', label: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
  { id: 'verdana', label: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
  { id: 'trebuchet', label: 'Trebuchet MS', stack: '"Trebuchet MS", Helvetica, sans-serif' },
  { id: 'tahoma', label: 'Tahoma', stack: 'Tahoma, Geneva, sans-serif' },
  { id: 'georgia', label: 'Georgia', stack: 'Georgia, "Times New Roman", serif' },
  { id: 'consolas', label: 'Consolas', stack: 'Consolas, "Courier New", monospace' },
] as const

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
