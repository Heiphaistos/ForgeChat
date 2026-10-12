import type { ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Field, Toggle } from './shared'
import { useT, type Key } from '../../i18n'
import { clampInt, colorFromInput, hex } from '../../lib/nameStyle'
import AvatarRing, { RING_WIDTH_MAX, type AvatarRingData, type RingStyle } from '../ui/AvatarRing'
import { COLOR_PRESETS } from './NameStyleFields'

/** Traits statiques ; « spin » et « pulse » sont des animations d'un anneau plein. */
const TRAITS: RingStyle[] = ['solid', 'dashed', 'dotted', 'double', 'glow']
const ANIMS: ('' | 'spin' | 'pulse')[] = ['', 'spin', 'pulse']

export const DEFAULT_RING: AvatarRingData = { colors: [0x5865f2, 0xeb459e], width: 3, style: 'solid' }

/**
 * Anneau d'avatar du profil de serveur : couleurs (1 à 3), trait, animation, épaisseur,
 * chaque choix montré sur l'avatar. `value` null = pas d'anneau. Mêmes bornes que
 * models/profile_style::parse_avatar_ring (3 couleurs 0xRRGGBB, épaisseur 1-8, style connu).
 */
export default function AvatarRingFields({ value, onChange, avatar }: {
  value: AvatarRingData | null
  onChange: (next: AvatarRingData | null) => void
  /** Avatar de `size` px à entourer (aperçus). */
  avatar: (size: number) => ReactNode
}) {
  const t = useT()
  const ring = value ?? DEFAULT_RING
  const patch = (p: Partial<AvatarRingData>) => onChange({ ...ring, ...p })
  const anim = ring.style === 'spin' || ring.style === 'pulse' ? ring.style : ''
  const trait: RingStyle = anim ? 'solid' : ring.style
  const setColor = (i: number, raw: string) => {
    const c = colorFromInput(raw)
    if (c != null) patch({ colors: ring.colors.map((v, j) => (j === i ? c : v)) })
  }
  const tile = (on: boolean) => `flex flex-col items-center gap-1.5 p-2 rounded-lg border transition ${on ? 'border-fc-accent bg-fc-accent/10' : 'border-fc-hover hover:border-fc-muted'}`
  const mini = (style: RingStyle) => (
    <span className="p-1.5"><AvatarRing ring={{ ...ring, style }} size={32}>{avatar(32)}</AvatarRing></span>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Toggle value={!!value} onChange={on => onChange(on ? ring : null)} label={t('pedit.ring.enable')} />
        <span className="text-sm text-fc-text">{t('pedit.ring.enable')}</span>
      </div>
      {value && (
        <>
          <Field label={t('pedit.ring.colors')} hint={t('pedit.ring.hint')}>
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {COLOR_PRESETS.map((p, i) => (
                  <button key={i} type="button" onClick={() => patch({ colors: p })}
                    aria-label={t('profileId.preset', { n: i + 1 })} aria-pressed={ring.colors.join() === p.join()}
                    className={`w-7 h-7 rounded-full border-2 ${ring.colors.join() === p.join() ? 'border-white' : 'border-transparent'}`}
                    style={{ background: p.length > 1 ? `conic-gradient(${[...p, p[0]].map(hex).join(', ')})` : hex(p[0]) }} />
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {ring.colors.map((c, i) => (
                  <label key={i} className="flex items-center gap-1.5 text-xs text-fc-muted">
                    <input type="color" value={hex(c)} onChange={e => setColor(i, e.target.value)} className="w-8 h-8 rounded cursor-pointer bg-transparent" aria-label={t('profileId.colorN', { n: i + 1 })} />
                    {ring.colors.length > 1 && (
                      <button type="button" onClick={() => patch({ colors: ring.colors.filter((_, j) => j !== i) })} aria-label={t('profileId.removeColor')} className="text-fc-muted hover:text-white">
                        <Trash2 size={12} />
                      </button>
                    )}
                  </label>
                ))}
                {ring.colors.length < 3 && (
                  <button type="button" onClick={() => patch({ colors: [...ring.colors, ring.colors[ring.colors.length - 1] ?? 0x5865f2] })} className="flex items-center gap-1 text-xs text-fc-muted hover:text-white">
                    <Plus size={12} /> {t('profileId.addColor')}
                  </button>
                )}
              </div>
            </div>
          </Field>

          <Field label={t('pedit.ring.style')}>
            <div role="radiogroup" aria-label={t('pedit.ring.style')} className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {TRAITS.map(s => (
                <button key={s} type="button" role="radio" aria-checked={trait === s} onClick={() => patch({ style: s })} className={tile(trait === s)}>
                  {mini(s)}
                  <span className="text-[10px] text-fc-muted">{t(`pedit.ring.style.${s}` as Key)}</span>
                </button>
              ))}
            </div>
          </Field>

          <Field label={t('pedit.ring.animation')} hint={t('pedit.ring.animationHint')}>
            <div role="radiogroup" aria-label={t('pedit.ring.animation')} className="grid grid-cols-3 gap-2 max-w-sm">
              {ANIMS.map(a => (
                <button key={a || 'none'} type="button" role="radio" aria-checked={anim === a}
                  onClick={() => patch({ style: a || trait })} className={tile(anim === a)}>
                  {mini(a || trait)}
                  <span className="text-[10px] text-fc-muted">{t(`pedit.ring.anim.${a || 'none'}` as Key)}</span>
                </button>
              ))}
            </div>
          </Field>

          <label className="flex items-center gap-3 text-xs text-fc-muted max-w-sm">
            {t('pedit.ring.width', { n: ring.width })}
            <input type="range" min={1} max={RING_WIDTH_MAX} step={1} value={ring.width}
              onChange={e => patch({ width: clampInt(Number(e.target.value), 1, RING_WIDTH_MAX) })}
              className="flex-1 accent-fc-accent" aria-label={t('pedit.ring.title')} />
          </label>
        </>
      )}
    </div>
  )
}
