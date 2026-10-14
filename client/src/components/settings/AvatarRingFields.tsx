import type { ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Field, Toggle } from './shared'
import { Chips, RangeRow } from './lookControls'
import { useT, type Key } from '../../i18n'
import { colorFromInput, hex } from '../../lib/nameStyle'
import AvatarRing, {
  RING_ANIMATED, RING_COLORS_MAX, RING_FILLS, RING_GAP_MAX, RING_RANGES, RING_SEGMENTED, RING_SHAPES, RING_STATIC,
  RING_WIDTH_MAX, cleanRing, ringNum, type AvatarRingData, type RingNumKey, type RingStyle,
} from '../ui/AvatarRing'
import { COLOR_PRESETS } from '../../lib/namePresets'

export const DEFAULT_RING: AvatarRingData = { colors: [0x5865f2, 0xeb459e], width: 3, style: 'solid' }

/** Réglages chiffrés dans l'ordre d'affichage, avec leur pas. */
const SLIDERS: { key: RingNumKey; label: Key; step: number; motion?: boolean }[] = [
  { key: 'speed', label: 'pedit.ring.speed', step: 5, motion: true },
  { key: 'intensity', label: 'ring.intensity', step: 5, motion: true },
  { key: 'brightness', label: 'pedit.ring.brightness', step: 5 },
  { key: 'glow', label: 'pedit.ring.glow', step: 5 },
  { key: 'opacity', label: 'ring.opacity', step: 5 },
]

/**
 * Éditeur complet de l'anneau d'avatar (profil de serveur et anneau global du compte) :
 * 1 à 8 couleurs, style (statiques / animés, chacun montré sur l'avatar), dégradé, angle, forme,
 * épaisseur, écart, segments, vitesse, intensité, luminosité, lueur, opacité, sens.
 * `value` null = pas d'anneau. Mêmes bornes que server/src/models/avatar_ring.rs (lib/avatarRing.ts).
 */
export default function AvatarRingFields({ value, onChange, avatar }: {
  value: AvatarRingData | null
  onChange: (next: AvatarRingData | null) => void
  /** Avatar de `size` px à entourer (aperçus). */
  avatar: (size: number) => ReactNode
}) {
  const t = useT()
  const ring = value ?? DEFAULT_RING
  // Chaque modification repasse par cleanRing : bornes garanties, défauts retirés.
  const patch = (p: Partial<AvatarRingData>) => onChange(cleanRing({ ...ring, ...p }) ?? ring)
  const animated = RING_ANIMATED.includes(ring.style)
  const setColor = (i: number, raw: string) => {
    const c = colorFromInput(raw)
    if (c != null) patch({ colors: ring.colors.map((v, j) => (j === i ? c : v)) })
  }
  const tile = (on: boolean) => `fc-pick flex flex-col items-center gap-1.5 p-2 rounded-lg border transition ${on ? 'border-fc-accent bg-fc-accent/10' : 'border-fc-hover hover:border-fc-muted'}`
  const styleGroup = (label: Key, styles: readonly RingStyle[]) => (
    <div>
      <p className="text-[11px] font-semibold text-fc-muted mb-2">{t(label)}</p>
      <div role="radiogroup" aria-label={t(label)} className="fc-pick-still grid grid-cols-3 sm:grid-cols-6 gap-2">
        {styles.map(s => (
          <button key={s} type="button" role="radio" aria-checked={ring.style === s} onClick={() => patch({ style: s })} className={tile(ring.style === s)}>
            <span className="p-1.5"><AvatarRing ring={{ ...ring, style: s }} size={32}>{avatar(32)}</AvatarRing></span>
            <span className="text-[10px] text-fc-muted text-center leading-tight">{t(`ring.style.${s}` as Key)}</span>
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Toggle value={!!value} onChange={on => onChange(on ? ring : null)} label={t('pedit.ring.enable')} />
        <span className="text-sm text-fc-text flex-1">{t('pedit.ring.enable')}</span>
        {value && <span className="p-3" aria-hidden><AvatarRing ring={ring} size={56}>{avatar(56)}</AvatarRing></span>}
      </div>
      {value && (
        <>
          <Field label={t('pedit.ring.colors')} hint={t('ring.colors.hint')}>
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {COLOR_PRESETS.map((p, i) => (
                  <button key={i} type="button" onClick={() => patch({ colors: p.slice(0, RING_COLORS_MAX) })}
                    aria-label={t('profileId.preset', { n: i + 1 })} aria-pressed={ring.colors.join() === p.join()}
                    className={`w-7 h-7 rounded-full border-2 ${ring.colors.join() === p.join() ? 'border-white' : 'border-transparent'}`}
                    style={{ background: p.length > 1 ? `conic-gradient(${[...p, p[0]].map(hex).join(', ')})` : hex(p[0]) }} />
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {ring.colors.map((c, i) => (
                  <span key={i} className="flex items-center gap-1.5 text-xs text-fc-muted">
                    <input type="color" value={hex(c)} onChange={e => setColor(i, e.target.value)} className="w-8 h-8 rounded cursor-pointer bg-transparent" aria-label={t('profileId.colorN', { n: i + 1 })} />
                    {ring.colors.length > 1 && (
                      <button type="button" onClick={() => patch({ colors: ring.colors.filter((_, j) => j !== i) })} aria-label={`${t('profileId.removeColor')} ${i + 1}`} className="text-fc-muted hover:text-white">
                        <Trash2 size={12} />
                      </button>
                    )}
                  </span>
                ))}
                {ring.colors.length < RING_COLORS_MAX && (
                  <button type="button" onClick={() => patch({ colors: [...ring.colors, ring.colors[ring.colors.length - 1] ?? 0x5865f2] })} className="flex items-center gap-1 text-xs text-fc-muted hover:text-white">
                    <Plus size={12} /> {t('profileId.addColor')}
                  </button>
                )}
              </div>
            </div>
          </Field>

          <Field label={t('pedit.ring.style')} hint={t('ring.style.hint')}>
            <div className="space-y-3">
              {styleGroup('ring.group.static', RING_STATIC)}
              {styleGroup('ring.group.animated', RING_ANIMATED)}
            </div>
          </Field>

          <div className="space-y-2 max-w-md">
            <Chips label={t('ring.fill')} value={ring.fill ?? 'conic'} options={RING_FILLS} labelOf={f => t(`ring.fill.${f}` as Key)} onChange={fill => patch({ fill })} />
            <RangeRow label={t('ring.angle', { n: ringNum(ring, 'angle') })} value={ringNum(ring, 'angle')} min={RING_RANGES.angle[0]} max={RING_RANGES.angle[1]} step={5} onChange={angle => patch({ angle })} />
            <Chips label={t('ring.shape')} value={ring.shape ?? 'circle'} options={RING_SHAPES} labelOf={s => t(`ring.shape.${s}` as Key)} onChange={shape => patch({ shape })} />
            <RangeRow label={t('pedit.ring.width', { n: ring.width })} value={ring.width} min={1} max={RING_WIDTH_MAX} onChange={width => patch({ width })} />
            <Chips label={t('ring.gap')} value={ring.gap == null ? 'auto' : 'px'} options={['auto', 'px'] as const}
              labelOf={g => (g === 'auto' ? t('ring.gap.auto') : t('ring.gap.px', { n: ring.gap ?? 2 }))}
              onChange={g => onChange(g === 'auto' ? cleanRing({ ...ring, gap: undefined }) ?? ring : cleanRing({ ...ring, gap: ring.gap ?? 2 }) ?? ring)} />
            {ring.gap != null && (
              <RangeRow label={t('ring.gap.px', { n: ring.gap })} value={ring.gap} min={0} max={RING_GAP_MAX} onChange={gap => patch({ gap })} />
            )}
            {RING_SEGMENTED.includes(ring.style) && (
              <RangeRow label={t('ring.segments', { n: ringNum(ring, 'segments') })} value={ringNum(ring, 'segments')} min={RING_RANGES.segments[0]} max={RING_RANGES.segments[1]} onChange={segments => patch({ segments })} />
            )}
            {SLIDERS.map(s => {
              const v = ringNum(ring, s.key)
              const [min, max] = RING_RANGES[s.key]
              return <RangeRow key={s.key} label={t(s.label, { n: v })} value={v} min={min} max={max} step={s.step} disabled={s.motion && !animated} onChange={n => patch({ [s.key]: n })} />
            })}
            <Chips label={t('pedit.ring.direction')} value={ring.direction ?? 'cw'} options={['cw', 'ccw'] as const}
              labelOf={d => t(d === 'cw' ? 'pdeco.opts.cw' : 'pdeco.opts.ccw')} onChange={direction => patch({ direction })} />
            <button type="button" onClick={() => onChange({ colors: ring.colors, width: ring.width, style: ring.style })} className="text-xs text-fc-muted hover:text-white underline">
              {t('ring.reset')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
