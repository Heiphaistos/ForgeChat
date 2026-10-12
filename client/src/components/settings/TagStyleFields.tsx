import { Field, Select } from './shared'
import { useT, type Key } from '../../i18n'
import { NAME_FONTS, TAG_BADGES, TAG_ICONS, colorFromInput, hex, type TagIcon, type TagStyle } from '../../lib/nameStyle'
import ClanTag, { TAG_ICON_COMPONENTS } from '../ui/ClanTag'

/**
 * Style d'une marque de clan : couleur principale, seconde couleur (dégradé), police, fond
 * et icône, avec aperçu. Sert à l'étiquette perso (couleur dans le style, facultative) et
 * aux tags de serveur (couleur dans la colonne `color`, obligatoire). Seuls des identifiants
 * de liste blanche (lib/nameStyle.ts, comme le serveur) et des couleurs validées sortent d'ici.
 */
export default function TagStyleFields({ name, color, onColor, colorOptional, value, onChange, fallback = 'outline' }: {
  /** Texte de la marque (aperçu). */
  name: string
  color: number | null
  onColor: (c: number | null) => void
  /** Étiquette perso : « sans couleur » possible. */
  colorOptional?: boolean
  /** Style sans la couleur principale. */
  value: Omit<TagStyle, 'color'>
  onChange: (next: Omit<TagStyle, 'color'>) => void
  fallback?: 'outline' | 'soft'
}) {
  const t = useT()
  const patch = (p: Partial<TagStyle>) => onChange({ ...value, ...p })
  const shown = name.trim() || 'TAG'
  const preview = (badge: TagStyle['badge']) => <ClanTag name={shown} color={color} style={{ ...value, badge }} fallback={fallback} />
  const pill = (on: boolean) => `px-2 py-1.5 rounded-lg border flex items-center justify-center transition ${on ? 'border-fc-accent bg-fc-accent/10' : 'border-fc-hover hover:border-fc-muted'}`

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-fc-hover bg-fc-bg px-3 py-2 flex items-center gap-2" aria-live="polite">
        <span className="text-xs text-fc-muted">{t('pedit.tag.preview')}</span>
        <ClanTag name={shown} color={color} style={value} fallback={fallback} />
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-xs text-fc-muted">
          <input type="color" value={hex(color ?? 0x7289da)} onChange={e => onColor(colorFromInput(e.target.value) ?? color)}
            className="w-8 h-8 rounded cursor-pointer bg-transparent" aria-label={t('pedit.tag.color')} />
          {t('pedit.tag.color')}
        </label>
        {colorOptional && color != null && (
          <button type="button" onClick={() => onColor(null)} className="text-xs text-fc-muted hover:text-white underline">{t('pedit.tag.noColor')}</button>
        )}
        <label className="flex items-center gap-2 text-xs text-fc-muted">
          <input type="color" value={hex(value.color2 ?? color ?? 0x7289da)} onChange={e => patch({ color2: colorFromInput(e.target.value) ?? value.color2 })}
            className="w-8 h-8 rounded cursor-pointer bg-transparent" aria-label={t('pedit.tag.color2')} />
          {t('pedit.tag.color2')}
        </label>
        {value.color2 != null && (
          <button type="button" onClick={() => patch({ color2: undefined })} className="text-xs text-fc-muted hover:text-white underline">{t('pedit.tag.noColor2')}</button>
        )}
      </div>

      <Field label={t('pedit.tag.badge')}>
        <div role="radiogroup" aria-label={t('pedit.tag.badge')} className="flex flex-wrap gap-2">
          {TAG_BADGES.map(b => (
            <button key={b || 'default'} type="button" role="radio" aria-checked={(value.badge ?? '') === b}
              aria-label={t(`pedit.tag.badge.${b || 'default'}` as Key)} title={t(`pedit.tag.badge.${b || 'default'}` as Key)}
              onClick={() => patch({ badge: b })} className={pill((value.badge ?? '') === b)}>
              {preview(b)}
            </button>
          ))}
        </div>
      </Field>

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label={t('pedit.tag.font')}>
          <Select value={value.font ?? ''} onChange={v => patch({ font: (NAME_FONTS as readonly string[]).includes(v) ? v as TagStyle['font'] : '' })} className="w-full"
            options={NAME_FONTS.map(f => ({ value: f, label: t(`profileId.font.${f || 'default'}` as Key) }))} />
        </Field>
        <Field label={t('pedit.tag.icon')}>
          <div role="radiogroup" aria-label={t('pedit.tag.icon')} className="flex flex-wrap gap-1.5">
            {TAG_ICONS.map(i => {
              const Icon = i ? TAG_ICON_COMPONENTS[i as Exclude<TagIcon, ''>] : null
              const label = t(`pedit.tag.icon.${i || 'none'}` as Key)
              return (
                <button key={i || 'none'} type="button" role="radio" aria-checked={(value.icon ?? '') === i} aria-label={label} title={label}
                  onClick={() => patch({ icon: i })} className={`w-8 h-8 ${pill((value.icon ?? '') === i)} text-fc-text`}>
                  {Icon ? <Icon size={14} aria-hidden /> : <span aria-hidden className="text-xs">∅</span>}
                </button>
              )
            })}
          </div>
        </Field>
      </div>
    </div>
  )
}
