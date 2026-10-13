import { useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, RotateCcw } from 'lucide-react'
import api from '../../../api/client'
import { useT, type Key } from '../../../i18n'
import { DEFAULT_LAYOUT, LAYOUT_CHOICES, LAYOUT_RANGES, type LayoutPrefs } from '../../../theme/applyTheme'
import { useThemeStore, type Density } from '../../../theme/themeStore'
import CategoryStyleEditor from './CategoryStyleEditor'

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

/** Densité des messages (compte) : ici et dans Accessibilité > densité visuelle. */
export function DensityChoice() {
  const t = useT()
  const density = useThemeStore(s => s.density)
  const setDensity = useThemeStore(s => s.setDensity)
  return (
    <Choice title={t('layout.messages')} value={density} options={DENSITIES}
      onChange={d => { setDensity(d); api.put('/user/settings', { interface_density: d }).catch(() => {}) }} />
  )
}

/** Format de l'heure (réglage du compte time_format, aussi dans Texte et images) : appliqué tout de suite. */
function ClockChoice() {
  const t = useT()
  const qc = useQueryClient()
  const { data } = useQuery<Record<string, unknown>>({ queryKey: ['user-settings'], queryFn: () => api.get('/user/settings').then(r => r.data), staleTime: 300_000 })
  const value = data?.time_format === '12h' ? '12h' : '24h'
  const pick = (time_format: '12h' | '24h') => {
    qc.setQueryData<Record<string, unknown>>(['user-settings'], d => ({ ...(d ?? {}), time_format }))
    api.put('/user/settings', { time_format }).catch(() => qc.invalidateQueries({ queryKey: ['user-settings'] }))
  }
  return (
    <Choice title={t('looksMore.layout.clock')} value={value} onChange={pick}
      options={[{ id: '24h', label: 'looksMore.layout.clock.24h' }, { id: '12h', label: 'looksMore.layout.clock.12h' }]} />
  )
}

/** Groupe repliable de réglages (la page reste lisible malgré leur nombre). */
function Group({ title, children, open: initial = false }: { title: string; children: ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial)
  return (
    <section className="rounded-lg border border-fc-hover">
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold text-fc-text hover:bg-fc-hover/40 rounded-lg">
        {title}
        <ChevronDown size={14} aria-hidden className={`text-fc-muted motion-safe:transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="space-y-4 px-3 pb-3 pt-1">{children}</div>}
    </section>
  )
}

/** Libellés des choix : `looksMore.layout.<réglage>.<valeur>`, sauf ceux qui existaient déjà. */
const OLD_KEYS: Record<string, Key> = {
  'members.right': 'layout.right', 'members.left': 'layout.left',
  'rail.show': 'layout.rail.show', 'rail.hover': 'layout.rail.hover',
  'composer.inset': 'layout.composer.inset', 'composer.floating': 'layout.composer.floating', 'composer.attached': 'layout.composer.attached',
  'bubbles.flat': 'layout.bubbles.flat', 'bubbles.cards': 'layout.bubbles.cards', 'bubbles.bubbles': 'layout.bubbles.bubbles',
  'chatWidth.full': 'layout.chatWidth.full', 'chatWidth.centered': 'layout.chatWidth.centered',
  'scrollbars.normal': 'layout.scrollbars.normal', 'scrollbars.thin': 'layout.scrollbars.thin', 'scrollbars.hidden': 'layout.scrollbars.hidden',
}
const TITLES: Partial<Record<keyof LayoutPrefs, Key>> = {
  members: 'layout.members', rail: 'layout.rail', composer: 'layout.composer', bubbles: 'layout.bubbles',
  chatWidth: 'layout.chatWidth', scrollbars: 'layout.scrollbars',
}
const HINTS: Record<string, Key> = { 'rail.hover': 'layout.rail.hoverHint' }

type ChoiceKey = keyof typeof LAYOUT_CHOICES
type RangeKey = keyof typeof LAYOUT_RANGES

/** Disposition : barres latérales, liste des salons, messages, en-tête, saisie, effets (appliqué tout de suite). */
export default function LayoutSettings() {
  const t = useT()
  const { layout, setLayout, category, setCategory } = useThemeStore()

  const pick = <K extends ChoiceKey>(k: K) => (
    <Choice title={t(TITLES[k] ?? (`looksMore.layout.${k}` as Key))} value={layout[k] as string}
      onChange={v => setLayout({ [k]: v } as Partial<LayoutPrefs>)}
      options={(LAYOUT_CHOICES[k] as readonly string[]).map(id => ({
        id,
        label: OLD_KEYS[`${k}.${id}`] ?? (`looksMore.layout.${k}.${id}` as Key),
        hint: HINTS[`${k}.${id}`],
      }))} />
  )
  const range = (k: RangeKey, unit: string, step = 1, title?: Key) => (
    <label className="block space-y-1">
      <span className="text-sm text-fc-text">{t(title ?? (`looksMore.layout.${k}` as Key))} — {layout[k]}{unit}</span>
      <input type="range" min={LAYOUT_RANGES[k][0]} max={LAYOUT_RANGES[k][1]} step={step} value={layout[k]}
        aria-label={t(title ?? (`looksMore.layout.${k}` as Key))} onChange={e => setLayout({ [k]: Number(e.target.value) } as Partial<LayoutPrefs>)}
        className="w-full accent-fc-accent" />
    </label>
  )

  return (
    <div className="space-y-3 p-4 rounded-xl border border-fc-hover bg-fc-channel">
      <Group title={t('looksMore.layout.group.panels')} open>
        {pick('sidebarSide')}
        {pick('railSide')}
        {pick('rail')}
        {pick('railSize')}
        {pick('members')}
        {pick('membersVisible')}
        {range('membersWidth', 'px', 10, 'layout.membersWidth')}
        {pick('channelDensity')}
      </Group>

      <Group title={t('looksMore.layout.group.messages')} open>
        <DensityChoice />
        {pick('chatMode')}
        {pick('bubbles')}
        {pick('avatarSize')}
        {pick('timestampPos')}
        <ClockChoice />
        <div className="grid sm:grid-cols-2 gap-4">
          {range('chatFontScale', '%', 5)}
          {range('lineHeight', '%', 5)}
          {range('messageGap', 'px', 2)}
        </div>
        {pick('chatWidth')}
        {layout.chatWidth === 'centered' && range('contentWidth', 'px', 20)}
        {pick('emojiSize')}
        {pick('imageSize')}
      </Group>

      <Group title={t('looksMore.layout.group.chrome')}>
        {pick('header')}
        {pick('composer')}
        {pick('corners')}
        {pick('scrollbars')}
        <label className="flex items-center gap-2 text-sm text-fc-text cursor-pointer">
          <input type="checkbox" checked={layout.reduceTransparency} onChange={e => setLayout({ reduceTransparency: e.target.checked })} className="accent-fc-accent" />
          {t('looksMore.layout.reduceTransparency')}
        </label>
        {!layout.reduceTransparency && range('glass', '%', 10)}
        <p className="text-xs text-fc-muted">{t('looksMore.layout.motionNote')}</p>
      </Group>

      <Group title={t('catStyle.title')}>
        <p className="text-xs text-fc-muted">{t('catStyle.hint')}</p>
        <CategoryStyleEditor value={category} onChange={setCategory} />
      </Group>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-fc-muted">{t('layout.synced')}</p>
        <button onClick={() => setLayout(DEFAULT_LAYOUT)} className="flex items-center gap-1 text-xs text-fc-muted hover:text-white">
          <RotateCcw size={12} /> {t('looksMore.layout.reset')}
        </button>
      </div>
    </div>
  )
}
