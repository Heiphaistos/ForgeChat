// Thème 5 : rail de rubriques en icônes rondes (comme le rail des serveurs) + panneau des sources de la rubrique.
import { useState } from 'react'
import { Flame, GripVertical, Search } from 'lucide-react'
import { GROUP_COLOR, Avatar, RubricIcon, Count, isCurrent, rowCls, useDrag, type Nav } from './shared'

export default function Theme5Rail({ nav }: { nav: Nav }) {
  const { t, view } = nav
  const [sel, setSel] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const viewCat = view.kind === 'category' ? view.category : view.kind === 'site' ? view.site.category : null
  const r = nav.rubrics.find(x => x.cat === (viewCat ?? sel)) ?? nav.rubrics[0]
  const cats = nav.rubrics.map(x => x.cat)
  const { drag, item } = useDrag((id, to) => nav.move(cats, id, to))
  const f = filter.trim().toLowerCase()
  const sites = r ? r.sites.filter(s => !f || s.name.toLowerCase().includes(f)) : []
  const circle = (on: boolean) => `relative flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center transition-all ${on ? 'bg-fc-accent text-white rounded-2xl' : 'bg-fc-hover/70 text-fc-text hover:bg-fc-hover hover:rounded-2xl'}`

  return (
    <div className="flex flex-col md:flex-row min-h-0 flex-1">
      <div className="flex md:flex-col items-center gap-2 p-2 overflow-x-auto md:overflow-y-auto md:w-16 flex-shrink-0 border-b md:border-b-0 md:border-r border-fc-hover" role="list">
        <button className={circle(view.kind === 'top')} onClick={() => nav.pick({ kind: 'top' })} aria-label={t('news.top')} title={t('news.top')}>
          <Flame size={18} className="text-orange-400" />
        </button>
        {nav.rubrics.map((x, idx) => {
          const on = r?.cat === x.cat && view.kind !== 'top'
          const sep = idx === 0 || nav.rubrics[idx - 1].group !== x.group
          return (
            <div key={x.cat} role="listitem" className="flex md:flex-col items-center gap-2 flex-shrink-0">
              {sep && <span className="w-0.5 h-6 md:w-6 md:h-0.5 rounded" style={{ background: GROUP_COLOR[x.group] }} aria-hidden />}
              <button {...item(x.cat, idx)} className={`${circle(on)} ${drag === x.cat ? 'opacity-40' : ''}`} title={x.short} aria-label={x.short}
                onClick={() => { setSel(x.cat); nav.pick({ kind: 'category', category: x.cat }) }}>
                <RubricIcon cat={x.cat} size={18} />
                {x.group === 'youtube' && <span className="absolute -top-0.5 -left-0.5 w-3 h-2 rounded-sm bg-fc-red" aria-hidden />}
                {x.today > 0 && <span className="absolute -bottom-1 -right-1 text-[9px] font-bold rounded-full px-1 bg-fc-accent text-white ring-2 ring-fc-channel">{x.today}</span>}
              </button>
            </div>
          )
        })}
      </div>
      {r && (
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="p-3 border-b border-fc-hover space-y-2">
            <h2 className="flex items-center gap-2 text-white font-semibold"><RubricIcon cat={r.cat} size={16} /> <span className="truncate">{r.short}</span></h2>
            <p className="text-xs text-fc-muted">{t(`news.group.${r.group}`)} · {t('news.nSources', { n: r.sites.length })} · {t('news.nToday', { n: r.today })}</p>
            <div className="flex items-center gap-2">
              <button onClick={() => nav.pick({ kind: 'category', category: r.cat })}
                className={`px-2.5 py-1 rounded-md text-sm ${isCurrent(view, r) ? 'bg-fc-accent text-white' : 'bg-fc-hover text-white'}`}>{t('news.wholeRubric')}</button>
              <label className="relative flex-1 min-w-0">
                <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-fc-muted" aria-hidden />
                <input value={filter} onChange={e => setFilter(e.target.value)} placeholder={t('news.filter')} aria-label={t('news.filter')}
                  className="w-full pl-7 pr-2 py-1 bg-fc-input rounded-md text-sm text-white outline-none focus:ring-2 focus:ring-fc-accent" />
              </label>
            </div>
          </div>
          <div className="p-2 space-y-0.5 overflow-y-auto flex-1">
            {sites.map(s => (
              <button key={s.id} onClick={() => nav.pick({ kind: 'site', site: s })} aria-current={isCurrent(view, s) ? 'page' : undefined} className={rowCls(isCurrent(view, s))}>
                <Avatar name={s.name} size={20} /><span className="truncate flex-1">{s.name}</span><Count n={s.today} muted />
              </button>
            ))}
            <p className="mt-3 flex items-center gap-2 p-2.5 rounded-lg border border-dashed border-fc-hover text-xs text-fc-muted">
              <GripVertical size={13} aria-hidden /> {t('news.railHint')}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
