import { Plus, Trash2 } from 'lucide-react'
import { Field } from './shared'
import { useT, type Key } from '../../i18n'
import { NAME_EFFECTS, NAME_FONTS, OUTLINE_WIDTH_MAX, clampInt, colorFromInput, hex, type NameStyle } from '../../lib/nameStyle'
import StyledNameText from '../ui/StyledNameText'

/** Préréglages (une couleur = unie, plusieurs = dégradé). */
export const COLOR_PRESETS: number[][] = [
  [0xff5c8a], [0xffd166], [0x5ee7df], [0x7dffb0], [0xb388ff], [0xff9f43],
  [0x00c6ff, 0x7b2ff7], [0xff7e5f, 0xfeb47b], [0xff00e5, 0x00f0ff],
  [0xff3d00, 0xffb300], [0x2ecc71, 0x5ee7df], [0xff3b30, 0xffcc00, 0x007aff],
]

export const EMPTY_STYLE: NameStyle = { colors: [], angle: 90, effect: '', font: '' }

const effectKey = (e: string) => `profileId.effect.${e || 'none'}` as Key
const fontKey = (f: string) => `profileId.font.${f || 'default'}` as Key

/**
 * Champs du style du pseudo, partagés par le profil du compte (ProfileIdentity) et le
 * profil de serveur (MyServerProfileTab) : couleur unie ou dégradé, effet, police, contour.
 * Chaque tuile d'effet et de police est un aperçu réel du pseudo. Seules des valeurs de
 * liste blanche, des couleurs validées et des nombres bornés entrent dans `value`.
 */
export default function NameStyleFields({ value, onChange, sample }: {
  value: NameStyle
  onChange: (next: NameStyle) => void
  /** Texte des tuiles d'aperçu (le pseudo). */
  sample: string
}) {
  const t = useT()
  const colors = value.colors ?? []
  const patch = (p: Partial<NameStyle>) => onChange({ ...value, ...p })
  const setColor = (i: number, raw: string) => {
    const c = colorFromInput(raw)
    if (c != null) patch({ colors: colors.map((v, j) => (j === i ? c : v)) })
  }
  const width = clampInt(value.outline_width ?? 0, 0, OUTLINE_WIDTH_MAX)
  const tileText = Array.from(sample).slice(0, 12).join('') || t('pedit.name.sample')
  const tile = (selected: boolean) =>
    `min-w-0 flex flex-col items-center gap-1 px-2 py-2 rounded-lg border transition ${selected ? 'border-fc-accent bg-fc-accent/10' : 'border-fc-hover hover:border-fc-muted'}`

  return (
    <div className="space-y-5">
      <Field label={t('profileId.color')} hint={t('profileId.colorHint')}>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => patch({ colors: [] })} aria-pressed={!colors.length}
              className={`h-7 px-2 rounded-full text-xs border ${!colors.length ? 'border-fc-accent text-white' : 'border-fc-hover text-fc-muted'}`}>
              {t('profileId.defaultColor')}
            </button>
            {COLOR_PRESETS.map((p, i) => (
              <button
                key={i}
                type="button"
                onClick={() => patch({ colors: p })}
                aria-label={t('profileId.preset', { n: i + 1 })}
                aria-pressed={colors.join() === p.join()}
                className={`w-7 h-7 rounded-full border-2 ${colors.join() === p.join() ? 'border-white' : 'border-transparent'}`}
                style={{ background: p.length > 1 ? `linear-gradient(135deg, ${p.map(hex).join(', ')})` : hex(p[0]) }}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {colors.map((c, i) => (
              <label key={i} className="flex items-center gap-1.5 text-xs text-fc-muted">
                <input type="color" value={hex(c)} onChange={e => setColor(i, e.target.value)} className="w-8 h-8 rounded cursor-pointer bg-transparent" aria-label={t('profileId.colorN', { n: i + 1 })} />
                {colors.length > 1 && (
                  <button type="button" onClick={() => patch({ colors: colors.filter((_, j) => j !== i) })} aria-label={t('profileId.removeColor')} className="text-fc-muted hover:text-white">
                    <Trash2 size={12} />
                  </button>
                )}
              </label>
            ))}
            {colors.length < 3 && (
              <button type="button" onClick={() => patch({ colors: [...colors, colors[colors.length - 1] ?? 0x5865f2] })} className="flex items-center gap-1 text-xs text-fc-muted hover:text-white">
                <Plus size={12} /> {colors.length ? t('profileId.addColor') : t('profileId.pickColor')}
              </button>
            )}
          </div>
          {colors.length > 1 && (
            <label className="flex items-center gap-3 text-xs text-fc-muted">
              {t('profileId.angle', { n: value.angle ?? 90 })}
              <input type="range" min={0} max={360} step={15} value={value.angle ?? 90} onChange={e => patch({ angle: clampInt(Number(e.target.value), 0, 360) })} className="flex-1 accent-fc-accent" />
            </label>
          )}
        </div>
      </Field>

      <Field label={t('profileId.effect')} hint={t('pedit.name.effectHint')}>
        <div role="radiogroup" aria-label={t('profileId.effect')} className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {NAME_EFFECTS.map(e => (
            <button key={e || 'none'} type="button" role="radio" aria-checked={(value.effect ?? '') === e}
              onClick={() => patch({ effect: e })} className={tile((value.effect ?? '') === e)}>
              <span className="h-6 flex items-center max-w-full overflow-hidden px-2">
                <StyledNameText text={tileText} style={{ ...value, effect: e }} className="text-sm font-semibold text-white whitespace-nowrap" />
              </span>
              <span className="text-[10px] text-fc-muted truncate max-w-full">{t(effectKey(e))}</span>
            </button>
          ))}
        </div>
      </Field>

      <Field label={t('profileId.font')}>
        <div role="radiogroup" aria-label={t('profileId.font')} className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {NAME_FONTS.map(f => (
            <button key={f || 'default'} type="button" role="radio" aria-checked={(value.font ?? '') === f}
              onClick={() => patch({ font: f })} className={tile((value.font ?? '') === f)}>
              <span className="h-6 flex items-center max-w-full overflow-hidden">
                <StyledNameText text={tileText} style={{ font: f }} className="text-sm text-white whitespace-nowrap" />
              </span>
              <span className="text-[10px] text-fc-muted truncate max-w-full">{t(fontKey(f))}</span>
            </button>
          ))}
        </div>
      </Field>

      <Field label={t('pedit.name.outline')} hint={t('pedit.name.outlineHint')}>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-fc-muted">
            <input
              type="color"
              value={hex(value.outline ?? 0)}
              onChange={e => {
                const c = colorFromInput(e.target.value)
                if (c != null) patch({ outline: c, outline_width: width || 1 })
              }}
              className="w-8 h-8 rounded cursor-pointer bg-transparent"
              aria-label={t('pedit.name.outlineColor')}
            />
            {t('pedit.name.outlineColor')}
          </label>
          <label className="flex flex-1 min-w-[10rem] items-center gap-3 text-xs text-fc-muted">
            {width ? t('pedit.name.outlineWidth', { n: width }) : t('pedit.name.outlineNone')}
            <input type="range" min={0} max={OUTLINE_WIDTH_MAX} step={1} value={width}
              onChange={e => patch({ outline_width: clampInt(Number(e.target.value), 0, OUTLINE_WIDTH_MAX), outline: value.outline ?? 0 })}
              className="flex-1 accent-fc-accent" aria-label={t('pedit.name.outline')} />
          </label>
        </div>
      </Field>
    </div>
  )
}
