// Choix du style des en-têtes de catégorie : forme, couleurs, police, taille, espacement, alignement,
// icône, flèche et majuscules. Utilisé pour tout ForgeChat (Apparence → Disposition) et pour un
// serveur précis (Apparence de ce serveur). Les aperçus utilisent les vraies règles de index.css.
import type { CSSProperties, ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { useT, type Key } from '../../../i18n'
import {
  CATEGORY_ALIGNS, CATEGORY_ARROWS, CATEGORY_FONTS, CATEGORY_ICON_IDS, CATEGORY_ICONS, CATEGORY_SHAPES, CATEGORY_SIZE_MAX,
  CATEGORY_SIZE_MIN, CATEGORY_SPACING_MAX, CATEGORY_SWATCHES, CATEGORY_WEIGHTS, DEFAULT_CATEGORY, categoryAttrs, categoryVars,
  type CategoryShape, type CategoryStyle,
} from '../../../theme/serverLook'
import { resolveTheme, useThemeStore } from '../../../theme/themeStore'
import { CategoryArrowIcon } from '../../layout/CategoryHeadDecor'

const OLD_LABELS: Partial<Record<CategoryShape, Key>> = {
  auto: 'catStyle.auto', plain: 'catStyle.plain', outline: 'catStyle.outline', pill: 'catStyle.pill',
  card: 'catStyle.card', bar: 'catStyle.bar', underline: 'catStyle.underline',
}
const shapeLabel = (s: CategoryShape): Key => OLD_LABELS[s] ?? (`looksMore.cat.shape.${s}` as Key)

/** En-tête miniature rendu comme dans la barre des salons (mêmes classes, variables propres à l'aperçu). */
export function CategoryPreview({ value, shape, label, accent }: { value: CategoryStyle; shape?: CategoryShape; label: string; accent?: string }) {
  const look = shape ? { ...value, shape } : value
  const glyph = CATEGORY_ICONS[look.icon]
  return (
    <div className="fc-cat flex items-center px-2 py-1 bg-fc-channel pointer-events-none overflow-hidden" {...categoryAttrs(look)}
      style={categoryVars(look, accent, true) as CSSProperties}>
      <div className="fc-cat-main flex items-center gap-1 min-w-0">
        <CategoryArrowIcon open arrow={look.arrow} />
        {glyph && <span aria-hidden className="fc-cat-icon">{glyph}</span>}
        <span className="fc-cat-label text-xs font-semibold text-fc-muted uppercase tracking-wide truncate">{label}</span>
      </div>
    </div>
  )
}

function Chips<T extends string>({ title, value, options, label, onChange }: {
  title: string; value: T; options: readonly T[]; label: (v: T) => ReactNode; onChange: (v: T) => void
}) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-sm text-fc-text">{title}</h4>
      <div role="radiogroup" aria-label={title} className="flex flex-wrap gap-1.5">
        {options.map(o => (
          <button key={o} role="radio" aria-checked={value === o} onClick={() => onChange(o)}
            className={`px-2.5 h-8 rounded-full text-xs border transition ${value === o ? 'border-fc-accent bg-fc-accent/15 text-fc-text' : 'border-fc-hover text-fc-muted hover:text-white'}`}>
            {label(o)}
          </button>
        ))}
      </div>
    </div>
  )
}

function ColorRow({ title, value, themeLabel, fallback, onChange }: {
  title: string; value: string | null; themeLabel: string; fallback: string; onChange: (c: string | null) => void
}) {
  const t = useT()
  return (
    <div className="space-y-1.5">
      <h4 className="text-sm text-fc-text">{title}</h4>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => onChange(null)} aria-pressed={value === null}
          className={`px-2.5 h-7 rounded-full text-xs border transition ${value === null ? 'border-fc-accent text-fc-text' : 'border-fc-hover text-fc-muted hover:text-white'}`}>
          {themeLabel}
        </button>
        {CATEGORY_SWATCHES.map(c => (
          <button key={c} onClick={() => onChange(c)} aria-label={c} aria-pressed={value === c}
            className={`w-7 h-7 rounded-full border-2 transition ${value === c ? 'border-fc-text scale-110' : 'border-transparent'}`}
            style={{ background: c }} />
        ))}
        <label className="flex items-center gap-1.5 text-xs text-fc-muted cursor-pointer">
          <input type="color" value={value ?? fallback} onChange={e => onChange(e.target.value)}
            aria-label={`${title} — ${t('catStyle.custom')}`} className="w-7 h-7 rounded bg-transparent cursor-pointer" />
          {t('catStyle.custom')}
        </label>
      </div>
    </div>
  )
}

export default function CategoryStyleEditor({ value, onChange }: { value: CategoryStyle; onChange: (patch: Partial<CategoryStyle>) => void }) {
  const t = useT()
  const accent = useThemeStore(s => resolveTheme(s).colors.accent)
  const sample = t('catStyle.sample')
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <h4 className="text-sm text-fc-text">{t('catStyle.shape')} <span className="text-fc-muted text-xs">({CATEGORY_SHAPES.length})</span></h4>
        <div role="radiogroup" aria-label={t('catStyle.shape')} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {CATEGORY_SHAPES.map(shape => (
            <button key={shape} role="radio" aria-checked={value.shape === shape} onClick={() => onChange({ shape })}
              className={`p-2 rounded-lg border text-left transition ${value.shape === shape ? 'border-fc-accent bg-fc-accent/10' : 'border-fc-hover hover:border-fc-muted'}`}>
              <CategoryPreview value={value} shape={shape} label={sample} accent={accent} />
              <span className="block mt-1.5 text-xs text-fc-text">{t(shapeLabel(shape))}</span>
            </button>
          ))}
        </div>
      </div>

      <ColorRow title={t('catStyle.color')} value={value.color} themeLabel={t('catStyle.themeColor')} fallback="#5865f2"
        onChange={color => onChange({ color })} />
      <ColorRow title={t('looksMore.cat.color2')} value={value.color2} themeLabel={t('looksMore.cat.color2Theme')} fallback="#00aff4"
        onChange={color2 => onChange({ color2 })} />

      <Chips title={t('looksMore.cat.font')} value={value.font} options={CATEGORY_FONTS} onChange={font => onChange({ font })}
        label={f => t(`looksMore.cat.font.${f}` as Key)} />
      <Chips title={t('looksMore.cat.weight')} value={value.weight} options={CATEGORY_WEIGHTS} onChange={weight => onChange({ weight })}
        label={w => t(`looksMore.cat.weight.${w}` as Key)} />

      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block space-y-1">
          <span className="text-sm text-fc-text">{t('looksMore.cat.size')} — {value.size}px</span>
          <input type="range" min={CATEGORY_SIZE_MIN} max={CATEGORY_SIZE_MAX} step={1} value={value.size}
            onChange={e => onChange({ size: Number(e.target.value) })} className="w-full accent-fc-accent" />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-fc-text">{t('looksMore.cat.spacing')} — {(value.spacing / 100).toFixed(2)} em</span>
          <input type="range" min={0} max={CATEGORY_SPACING_MAX} step={1} value={value.spacing}
            onChange={e => onChange({ spacing: Number(e.target.value) })} className="w-full accent-fc-accent" />
        </label>
      </div>

      <Chips title={t('looksMore.cat.align')} value={value.align} options={CATEGORY_ALIGNS} onChange={align => onChange({ align })}
        label={a => t(`looksMore.cat.align.${a}` as Key)} />
      <Chips title={t('looksMore.cat.arrow')} value={value.arrow} options={CATEGORY_ARROWS} onChange={arrow => onChange({ arrow })}
        label={a => (
          <span className="inline-flex items-center gap-1.5">
            {a !== 'none' && <CategoryArrowIcon open={false} arrow={a} />}
            {t(`looksMore.cat.arrow.${a}` as Key)}
          </span>
        )} />

      <div className="space-y-1.5">
        <h4 className="text-sm text-fc-text">{t('looksMore.cat.icon')}</h4>
        <div role="radiogroup" aria-label={t('looksMore.cat.icon')} className="flex flex-wrap gap-1.5">
          {CATEGORY_ICON_IDS.map(id => (
            <button key={id} role="radio" aria-checked={value.icon === id} onClick={() => onChange({ icon: id })}
              title={t(`looksMore.cat.icon.${id}` as Key)} aria-label={t(`looksMore.cat.icon.${id}` as Key)}
              className={`min-w-[2rem] h-8 px-1.5 rounded-lg border text-sm transition ${value.icon === id ? 'border-fc-accent bg-fc-accent/15 text-fc-text' : 'border-fc-hover text-fc-muted hover:text-white'}`}>
              {CATEGORY_ICONS[id] || '∅'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-fc-text cursor-pointer">
          <input type="checkbox" checked={value.uppercase} onChange={e => onChange({ uppercase: e.target.checked })} className="accent-fc-accent" />
          {t('catStyle.uppercase')}
        </label>
        <button onClick={() => onChange({ ...DEFAULT_CATEGORY })} className="flex items-center gap-1 text-xs text-fc-muted hover:text-white">
          <RotateCcw size={12} /> {t('looksMore.cat.reset')}
        </button>
      </div>

      <div className="space-y-1">
        <h4 className="text-xs text-fc-muted">{t('looksMore.cat.preview')}</h4>
        <div className="rounded-lg border border-fc-hover p-1 bg-fc-channel">
          <CategoryPreview value={value} label={t('looksMore.cat.previewName')} accent={accent} />
        </div>
      </div>
    </div>
  )
}
