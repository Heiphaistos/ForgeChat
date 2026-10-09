// Thème 8 : onglets Rubriques / YouTube (avatars, point rouge = nouveauté) / Sources A-Z, mode « Terminer » pour réordonner.
import { useState } from 'react'
import { Check, ArrowUpDown, GripVertical, Youtube } from 'lucide-react'
import { TopButton } from './Theme1Sidebar'
import { Avatar, Count, RubricIcon, UpDown, isCurrent, isFresh, rowCls, useDrag, type Nav, type Rubric } from './shared'

/** Cartes de rubriques avec les avatars de leurs sources ; en mode édition, poignées et flèches. */
export function RubricCards({ nav, list, unit }: { nav: Nav; list: Rubric[]; unit: 'channels' | 'sources' }) {
  const { t } = nav
  const [editing, setEditing] = useState(false)
  const cats = list.map(r => r.cat)
  const { drag, item } = useDrag((id, to) => nav.move(cats, id, to))
  const total = list.reduce((n, r) => n + r.sites.length, 0)
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-fc-muted truncate">
          {t('news.nThemes', { n: list.length })} · {t(unit === 'channels' ? 'news.nChannels' : 'news.nSources', { n: total })}
        </span>
        <button onClick={() => setEditing(!editing)} aria-pressed={editing}
          className={`flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium ${editing ? 'bg-fc-accent text-white' : 'bg-fc-hover text-fc-text hover:text-white'}`}>
          {editing ? <><Check size={12} /> {t('news.done')}</> : <><ArrowUpDown size={12} /> {t('news.reorderShort')}</>}
        </button>
      </div>
      {list.map((r, idx) => (
        <div key={r.cat} {...(editing ? item(r.cat, idx) : {})}
          className={`rounded-lg border p-2 ${isCurrent(nav.view, r) ? 'border-fc-accent bg-fc-hover/40' : 'border-fc-hover'} ${drag === r.cat ? 'opacity-40' : ''}`}>
          <div className="flex items-center gap-1.5 min-w-0">
            {editing && <GripVertical size={13} className="text-fc-muted flex-shrink-0" aria-hidden />}
            <button onClick={() => nav.pick({ kind: 'category', category: r.cat })} className="flex-1 min-w-0 flex items-center gap-1.5 text-left text-sm font-semibold text-white hover:underline">
              <RubricIcon cat={r.cat} size={14} className="text-fc-muted" /><span className="truncate">{r.short}</span>
            </button>
            <Count n={r.today} />
            {editing && <UpDown label={r.short} onUp={idx > 0 ? () => nav.move(cats, r.cat, idx - 1) : undefined} onDown={idx < list.length - 1 ? () => nav.move(cats, r.cat, idx + 1) : undefined} />}
          </div>
          <div className="grid grid-cols-4 gap-1 mt-2">
            {r.sites.slice(0, 3).map(s => (
              <button key={s.id} onClick={() => nav.pick({ kind: 'site', site: s })} title={s.name}
                className={`flex flex-col items-center gap-1 min-w-0 rounded p-0.5 ${isCurrent(nav.view, s) ? 'bg-fc-hover' : 'hover:bg-fc-hover/60'}`}>
                <Avatar name={s.name} size={30} dot={isFresh(s, nav.seen)} />
                <span className="text-[10px] text-fc-muted truncate w-full text-center">{s.name}</span>
              </button>
            ))}
            {r.sites.length > 3 && (
              <button onClick={() => nav.pick({ kind: 'category', category: r.cat })} className="flex flex-col items-center gap-1 min-w-0 p-0.5 text-fc-muted hover:text-white">
                <span className="w-[30px] h-[30px] rounded-full border border-dashed border-fc-hover flex items-center justify-center text-[10px]">+{r.sites.length - 3}</span>
                <span className="text-[10px] truncate w-full text-center">{t(unit === 'channels' ? 'news.channels' : 'news.sources')}</span>
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Onglet YouTube : les chaînes par thème, en avatars. */
export function YouTubeTab({ nav }: { nav: Nav }) {
  const yt = nav.groups.find(g => g.id === 'youtube')
  return yt ? <RubricCards nav={nav} list={yt.rubrics} unit="channels" /> : <p className="p-2 text-sm text-fc-muted">{nav.t('news.empty')}</p>
}

function SourcesAZ({ nav }: { nav: Nav }) {
  const letters = new Map<string, typeof nav.sites>()
  for (const s of nav.sites) {
    const l = s.name.trim().charAt(0).toUpperCase().normalize('NFD').replace(/\p{M}/gu, '')
    letters.set(/[A-Z]/.test(l) ? l : '#', [...(letters.get(/[A-Z]/.test(l) ? l : '#') ?? []), s])
  }
  return (
    <div>
      {[...letters].map(([l, list]) => (
        <div key={l}>
          <div className="px-2 pt-2 pb-0.5 text-[11px] font-bold text-fc-accent">{l}</div>
          {list.map(s => (
            <button key={s.id} onClick={() => nav.pick({ kind: 'site', site: s })} className={rowCls(isCurrent(nav.view, s))}>
              <Avatar name={s.name} size={18} dot={isFresh(s, nav.seen)} /><span className="truncate flex-1">{s.name}</span><Count n={s.today} muted />
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

export type Tab8 = 'rubrics' | 'youtube' | 'az'
/** Sélecteur d'onglets segmenté (réutilisé par le thème 6). */
export function Segmented<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string, boolean?][] }) {
  return (
    <div className="flex p-0.5 rounded-lg border border-fc-hover bg-fc-chat" role="tablist">
      {items.map(([v, label, yt]) => (
        <button key={v} role="tab" aria-selected={value === v} onClick={() => onChange(v)}
          className={`flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap ${value === v ? 'bg-fc-hover text-white' : 'text-fc-muted hover:text-white'}`}>
          {yt && <Youtube size={13} className="text-fc-red" aria-hidden />}{label}
        </button>
      ))}
    </div>
  )
}

export default function Theme8Tabs({ nav }: { nav: Nav }) {
  const { t } = nav
  const [tab, setTab] = useState<Tab8>('youtube')
  const others = nav.rubrics.filter(r => r.group !== 'youtube')
  return (
    <nav className="p-2 space-y-2">
      <TopButton nav={nav} />
      <Segmented value={tab} onChange={setTab} items={[['rubrics', t('news.rubrics')], ['youtube', 'YouTube', true], ['az', t('news.sourcesAZ')]]} />
      {tab === 'rubrics' && <RubricCards nav={nav} list={others} unit="sources" />}
      {tab === 'youtube' && <YouTubeTab nav={nav} />}
      {tab === 'az' && <SourcesAZ nav={nav} />}
    </nav>
  )
}
