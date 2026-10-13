// Flèche de repli et icône des en-têtes de catégorie, selon le style choisi (Apparence → Disposition
// ou apparence propre au serveur ouvert). L'icône vient d'une liste fixe (serverLook.ts).
import { ArrowRight, ChevronRight, Minus, Play, Plus } from 'lucide-react'
import { CATEGORY_ICONS, type CategoryArrow } from '../../theme/serverLook'
import { effectiveCategory, useThemeStore } from '../../theme/themeStore'

export function CategoryArrowIcon({ open, arrow }: { open: boolean; arrow?: CategoryArrow }) {
  const style = useThemeStore(s => effectiveCategory(s).arrow)
  const kind = arrow ?? style
  const cls = 'text-fc-muted flex-shrink-0 motion-safe:transition-transform'
  switch (kind) {
    case 'none': return null
    case 'caret': return <Play size={8} fill="currentColor" aria-hidden className={`${cls} ${open ? 'rotate-90' : ''}`} />
    case 'plus': return open ? <Minus size={11} aria-hidden className={cls} /> : <Plus size={11} aria-hidden className={cls} />
    case 'arrow': return <ArrowRight size={11} aria-hidden className={`${cls} ${open ? 'rotate-90' : ''}`} />
    default: return <ChevronRight size={12} aria-hidden className={`${cls} ${open ? 'rotate-90' : ''}`} />
  }
}

export function CategoryIconGlyph() {
  const icon = useThemeStore(s => effectiveCategory(s).icon)
  const glyph = CATEGORY_ICONS[icon]
  return glyph ? <span aria-hidden className="fc-cat-icon select-none">{glyph}</span> : null
}
