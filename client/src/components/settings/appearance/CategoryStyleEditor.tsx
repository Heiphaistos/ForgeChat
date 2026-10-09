// Choix du style des en-têtes de catégorie : forme, couleur, majuscules. Utilisé pour tout
// ForgeChat (Apparence → Disposition) et pour un serveur précis (Apparence de ce serveur).
import type { CSSProperties } from 'react'
import { useT, type Key } from '../../../i18n'
import { CATEGORY_SHAPES, CATEGORY_SWATCHES, type CategoryShape, type CategoryStyle } from '../../../theme/serverLook'

const LABELS: Record<CategoryShape, Key> = {
  auto: 'catStyle.auto', plain: 'catStyle.plain', outline: 'catStyle.outline', pill: 'catStyle.pill',
  card: 'catStyle.card', bar: 'catStyle.bar', underline: 'catStyle.underline',
}

/** Aperçu miniature d'un en-tête dans le style donné (mêmes règles que index.css, en ligne). */
function sample(shape: CategoryShape, color: string): CSSProperties {
  const tint = (a: number) => `color-mix(in srgb, ${color} ${a}%, transparent)`
  switch (shape) {
    case 'outline': return { outline: `1px solid ${color}`, outlineOffset: -1, borderRadius: 6 }
    case 'pill': return { borderRadius: 9999, background: tint(16), color }
    case 'card': return { borderRadius: 8, background: 'rgb(var(--fc-hover-rgb))', boxShadow: `0 1px 3px rgb(0 0 0 / .35), inset 0 0 0 1px ${tint(60)}` }
    case 'bar': return { borderLeft: `3px solid ${color}`, borderRadius: '0 6px 6px 0', background: `linear-gradient(90deg, ${tint(18)}, transparent 85%)`, color }
    case 'underline': return { boxShadow: `inset 0 -1px 0 ${tint(70)}`, color }
    default: return {}
  }
}

export default function CategoryStyleEditor({ value, onChange }: { value: CategoryStyle; onChange: (patch: Partial<CategoryStyle>) => void }) {
  const t = useT()
  const color = value.color ?? 'rgb(var(--fc-accent-rgb))'
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label={t('catStyle.shape')} className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {CATEGORY_SHAPES.map(shape => (
          <button key={shape} role="radio" aria-checked={value.shape === shape} onClick={() => onChange({ shape })}
            className={`p-2 rounded-lg border text-left transition ${value.shape === shape ? 'border-fc-accent bg-fc-accent/10' : 'border-fc-hover hover:border-fc-muted'}`}>
            <span className="block px-2 py-1 text-[10px] font-semibold tracking-wide text-fc-muted truncate"
              style={{ ...sample(shape === 'auto' ? 'plain' : shape, color), textTransform: value.uppercase ? 'uppercase' : 'none' }}>
              {t('catStyle.sample')}
            </span>
            <span className="block mt-1.5 text-xs text-fc-text">{t(LABELS[shape])}</span>
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        <h4 className="text-sm text-fc-text">{t('catStyle.color')}</h4>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => onChange({ color: null })} aria-pressed={value.color === null}
            className={`px-2.5 h-7 rounded-full text-xs border transition ${value.color === null ? 'border-fc-accent text-fc-text' : 'border-fc-hover text-fc-muted hover:text-white'}`}>
            {t('catStyle.themeColor')}
          </button>
          {CATEGORY_SWATCHES.map(c => (
            <button key={c} onClick={() => onChange({ color: c })} aria-label={c} aria-pressed={value.color === c}
              className={`w-7 h-7 rounded-full border-2 transition ${value.color === c ? 'border-white scale-110' : 'border-transparent'}`}
              style={{ background: c }} />
          ))}
          <label className="flex items-center gap-1.5 text-xs text-fc-muted cursor-pointer">
            <input type="color" value={value.color ?? '#5865f2'} onChange={e => onChange({ color: e.target.value })}
              aria-label={t('catStyle.custom')} className="w-7 h-7 rounded bg-transparent cursor-pointer" />
            {t('catStyle.custom')}
          </label>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-fc-text cursor-pointer">
        <input type="checkbox" checked={value.uppercase} onChange={e => onChange({ uppercase: e.target.checked })} className="accent-fc-accent" />
        {t('catStyle.uppercase')}
      </label>
    </div>
  )
}
