import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Field } from './shared'
import { useT, type Key } from '../../i18n'
import {
  LEVEL_DEFAULT, LEVEL_MAX, NAME_COLORS_MAX, NAME_EFFECTS, NAME_FONTS, NAME_GRADIENTS, OUTLINE_STYLES, OUTLINE_WIDTH_MAX,
  clampInt, colorFromInput, hex, type NameStyle,
} from '../../lib/nameStyle'
import { NAME_PRESET_GROUPS } from '../../lib/namePresets'
import StyledNameText from '../ui/StyledNameText'


export const EMPTY_STYLE: NameStyle = { colors: [], angle: 90, effect: '', font: '' }

const effectKey = (e: string) => `profileId.effect.${e || 'none'}` as Key
const fontKey = (f: string) => `profileId.font.${f || 'default'}` as Key
const swatch = (p: number[]) => (p.length > 1 ? `linear-gradient(135deg, ${p.map(hex).join(', ')})` : hex(p[0]))

/**
 * Champs du style du pseudo, partagés par le profil du compte (ProfileIdentity) et le
 * profil de serveur (MyServerProfileTab) : couleur unie ou dégradé (préréglages par
 * familles, 5 couleurs, type de dégradé), effet (intensité, vitesse), police, contour.
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
  const [group, setGroup] = useState(NAME_PRESET_GROUPS[0].id)
  const colors = value.colors ?? []
  const patch = (p: Partial<NameStyle>) => onChange({ ...value, ...p })
  const setColor = (i: number, raw: string) => {
    const c = colorFromInput(raw)
    if (c != null) patch({ colors: colors.map((v, j) => (j === i ? c : v)) })
  }
  const width = clampInt(value.outline_width ?? 0, 0, OUTLINE_WIDTH_MAX)
  const intensity = clampInt(value.intensity ?? LEVEL_DEFAULT, 1, LEVEL_MAX)
  const speed = clampInt(value.speed ?? LEVEL_DEFAULT, 1, LEVEL_MAX)
  const gradient = value.gradient ?? ''
  const tileText = Array.from(sample).slice(0, 12).join('') || t('pedit.name.sample')
  const tile = (selected: boolean) =>
    `min-w-0 flex flex-col items-center gap-1 px-2 py-2 rounded-lg border transition ${selected ? 'border-fc-accent bg-fc-accent/10' : 'border-fc-hover hover:border-fc-muted'}`
  const chip = (selected: boolean) =>
    `h-7 px-2.5 rounded-full text-xs border transition ${selected ? 'border-fc-accent bg-fc-accent/10 text-white' : 'border-fc-hover text-fc-muted hover:text-white'}`
  const current = NAME_PRESET_GROUPS.find(g => g.id === group) ?? NAME_PRESET_GROUPS[0]
  const presetButton = (p: number[], i: number) => (
    <button
      key={i}
      type="button"
      onClick={() => patch({ colors: p })}
      aria-label={t('nameStyle.presetIn', { group: t(`nameStyle.group.${current.id}` as Key), n: i + 1 })}
      aria-pressed={colors.join() === p.join()}
      className={`${p.length > 1 ? 'w-10' : 'w-7'} h-7 rounded-full border-2 ${colors.join() === p.join() ? 'border-white' : 'border-transparent'}`}
      style={{ background: swatch(p) }}
    />
  )

  return (
    <div className="space-y-5">
      <Field label={t('profileId.color')} hint={t('profileId.colorHint')}>
        <div className="space-y-3">
          <div role="tablist" aria-label={t('nameStyle.presets')} className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => patch({ colors: [] })} aria-pressed={!colors.length} className={chip(!colors.length)}>
              {t('profileId.defaultColor')}
            </button>
            {NAME_PRESET_GROUPS.map(g => (
              <button key={g.id} type="button" role="tab" aria-selected={g.id === current.id} onClick={() => setGroup(g.id)} className={chip(g.id === current.id)}>
                {t(`nameStyle.group.${g.id}` as Key)}
              </button>
            ))}
          </div>
          {current.solids.length > 0 && (
            <div className="flex flex-wrap gap-2" aria-label={t('nameStyle.solids')}>
              {current.solids.map((c, i) => presetButton([c], i))}
            </div>
          )}
          <div className="flex flex-wrap gap-2" aria-label={t('nameStyle.gradients')}>
            {current.gradients.map((p, i) => presetButton(p, current.solids.length + i))}
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
            {colors.length < NAME_COLORS_MAX && (
              <button type="button" onClick={() => patch({ colors: [...colors, colors[colors.length - 1] ?? 0x5865f2] })} className="flex items-center gap-1 text-xs text-fc-muted hover:text-white">
                <Plus size={12} /> {colors.length ? t('profileId.addColor') : t('profileId.pickColor')}
              </button>
            )}
          </div>
          {colors.length > 1 && (
            <>
              <div role="radiogroup" aria-label={t('nameStyle.gradientType')} className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-fc-muted mr-1">{t('nameStyle.gradientType')}</span>
                {NAME_GRADIENTS.map(g => (
                  <button key={g || 'linear'} type="button" role="radio" aria-checked={gradient === g} onClick={() => patch({ gradient: g })} className={chip(gradient === g)}>
                    {t(`nameStyle.gradient.${g || 'linear'}` as Key)}
                  </button>
                ))}
              </div>
              {gradient !== 'radial' && (
                <label className="flex items-center gap-3 text-xs text-fc-muted">
                  {t('profileId.angle', { n: value.angle ?? 90 })}
                  <input type="range" min={0} max={360} step={15} value={value.angle ?? 90} onChange={e => patch({ angle: clampInt(Number(e.target.value), 0, 360) })} className="flex-1 accent-fc-accent" />
                </label>
              )}
            </>
          )}
        </div>
      </Field>

      <Field label={t('profileId.effect')} hint={t('pedit.name.effectHint')}>
        <div className="space-y-3">
          <div role="radiogroup" aria-label={t('profileId.effect')} className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {NAME_EFFECTS.map(e => (
              <button key={e || 'none'} type="button" role="radio" aria-checked={(value.effect ?? '') === e}
                onClick={() => patch({ effect: e })} className={tile((value.effect ?? '') === e)}>
                <span className="h-7 flex items-center max-w-full overflow-hidden px-2">
                  <StyledNameText text={tileText} style={{ ...value, effect: e }} className="text-sm font-semibold text-white whitespace-nowrap" />
                </span>
                <span className="text-[10px] text-fc-muted truncate max-w-full">{t(effectKey(e))}</span>
              </button>
            ))}
          </div>
          {value.effect && (
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="flex items-center gap-3 text-xs text-fc-muted">
                <span className="w-28 shrink-0">{t('nameStyle.intensity', { n: intensity })}</span>
                <input type="range" min={1} max={LEVEL_MAX} step={1} value={intensity}
                  onChange={e => patch({ intensity: clampInt(Number(e.target.value), 1, LEVEL_MAX) })} className="flex-1 accent-fc-accent" />
              </label>
              <label className="flex items-center gap-3 text-xs text-fc-muted">
                <span className="w-28 shrink-0">{t('nameStyle.speed', { n: speed })}</span>
                <input type="range" min={1} max={LEVEL_MAX} step={1} value={speed}
                  onChange={e => patch({ speed: clampInt(Number(e.target.value), 1, LEVEL_MAX) })} className="flex-1 accent-fc-accent" />
              </label>
            </div>
          )}
        </div>
      </Field>

      <Field label={t('profileId.font')} hint={t('nameStyle.fontHint')}>
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
        <div className="space-y-3">
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
          {width > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <div role="radiogroup" aria-label={t('nameStyle.outlineStyle')} className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-fc-muted mr-1">{t('nameStyle.outlineStyle')}</span>
                {OUTLINE_STYLES.map(o => (
                  <button key={o || 'solid'} type="button" role="radio" aria-checked={(value.outline_style ?? '') === o}
                    onClick={() => patch({ outline_style: o, outline2: o === 'double' ? value.outline2 ?? 0xffffff : undefined })}
                    className={chip((value.outline_style ?? '') === o)}>
                    {t(`nameStyle.outlineStyle.${o || 'solid'}` as Key)}
                  </button>
                ))}
              </div>
              {value.outline_style === 'double' && (
                <label className="flex items-center gap-2 text-xs text-fc-muted">
                  <input
                    type="color"
                    value={hex(value.outline2 ?? 0xffffff)}
                    onChange={e => {
                      const c = colorFromInput(e.target.value)
                      if (c != null) patch({ outline2: c })
                    }}
                    className="w-8 h-8 rounded cursor-pointer bg-transparent"
                    aria-label={t('nameStyle.outline2')}
                  />
                  {t('nameStyle.outline2')}
                </label>
              )}
            </div>
          )}
        </div>
      </Field>
    </div>
  )
}
