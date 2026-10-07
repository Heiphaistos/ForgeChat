import api from '../../../api/client'
import { useT, type Key } from '../../../i18n'
import { MEMBERS_MAX, MEMBERS_MIN, type LayoutPrefs } from '../../../theme/applyTheme'
import { useThemeStore, type Density } from '../../../theme/themeStore'

function Choice<T extends string>({ title, value, options, onChange }: {
  title: string; value: T; options: { id: T; label: Key; hint?: Key }[]; onChange: (v: T) => void
}) {
  const t = useT()
  return (
    <div className="space-y-1.5">
      <h4 className="text-sm text-fc-text">{title}</h4>
      <div role="radiogroup" aria-label={title} className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {options.map(o => (
          <button key={o.id} role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}
            title={o.hint ? t(o.hint) : undefined}
            className={`px-3 py-2 rounded-lg text-sm border transition ${value === o.id ? 'border-fc-accent bg-fc-accent/10 text-fc-text' : 'border-fc-hover text-fc-muted hover:text-white'}`}>
            {t(o.label)}
          </button>
        ))}
      </div>
    </div>
  )
}

const DENSITIES: { id: Density; label: Key; hint: Key }[] = [
  { id: 'comfortable', label: 'layout.density.comfortable', hint: 'layout.density.comfortableHint' },
  { id: 'normal', label: 'layout.density.cozy', hint: 'layout.density.cozyHint' },
  { id: 'compact', label: 'layout.density.compact', hint: 'layout.density.compactHint' },
  { id: 'ultra-compact', label: 'layout.density.ultra', hint: 'layout.density.ultraHint' },
]

/** Disposition : messages, liste des membres, rail des serveurs, barre de saisie (appliqué tout de suite). */
export default function LayoutSettings() {
  const t = useT()
  const { layout, setLayout, density, setDensity } = useThemeStore()
  const set = <K extends keyof LayoutPrefs>(k: K) => (v: LayoutPrefs[K]) => setLayout({ [k]: v } as Partial<LayoutPrefs>)

  return (
    <div className="space-y-4 p-4 rounded-xl border border-fc-hover bg-fc-channel">
      <Choice title={t('layout.messages')} value={density} options={DENSITIES}
        onChange={d => { setDensity(d); api.put('/user/settings', { interface_density: d }).catch(() => {}) }} />
      <Choice title={t('layout.members')} value={layout.members} onChange={set('members')}
        options={[{ id: 'right', label: 'layout.right' }, { id: 'left', label: 'layout.left' }]} />
      <div className="space-y-1">
        <h4 className="text-sm text-fc-text">{t('layout.membersWidth')} — {layout.membersWidth}px</h4>
        <input type="range" min={MEMBERS_MIN} max={MEMBERS_MAX} step={10} value={layout.membersWidth}
          aria-label={t('layout.membersWidth')} onChange={e => setLayout({ membersWidth: Number(e.target.value) })}
          className="w-full accent-fc-accent" />
      </div>
      <Choice title={t('layout.rail')} value={layout.rail} onChange={set('rail')}
        options={[{ id: 'show', label: 'layout.rail.show' }, { id: 'hover', label: 'layout.rail.hover', hint: 'layout.rail.hoverHint' }]} />
      <Choice title={t('layout.composer')} value={layout.composer} onChange={set('composer')}
        options={[
          { id: 'inset', label: 'layout.composer.inset' },
          { id: 'floating', label: 'layout.composer.floating' },
          { id: 'attached', label: 'layout.composer.attached' },
        ]} />
      <p className="text-xs text-fc-muted">{t('layout.synced')}</p>
    </div>
  )
}
