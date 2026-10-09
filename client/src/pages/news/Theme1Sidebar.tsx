// Thème 1 : barre latérale à deux niveaux — groupes colorés > rubriques repliables > sites.
import { useState } from 'react'
import { ChevronRight, Flame, GripVertical } from 'lucide-react'
import { GROUP_COLOR, GROUP_ICON, Avatar, Count, isCurrent, rowCls, useDrag, type Nav, type Rubric } from './shared'

const SHOWN = 5

export function TopButton({ nav }: { nav: Nav }) {
  const on = nav.view.kind === 'top'
  return (
    <button onClick={() => nav.pick({ kind: 'top' })} aria-current={on ? 'page' : undefined} className={`${rowCls(on)} font-medium`}>
      <Flame size={15} className="text-orange-400" /> {nav.t('news.top')}
    </button>
  )
}

/** Sites d'une rubrique, les premiers puis « + N autres sources ». */
export function SiteList({ nav, r, indent = 'pl-6' }: { nav: Nav; r: Rubric; indent?: string }) {
  const [all, setAll] = useState(false)
  const list = all ? r.sites : r.sites.slice(0, SHOWN)
  return (
    <>
      {list.map(s => (
        <button key={s.id} onClick={() => nav.pick({ kind: 'site', site: s })} aria-current={isCurrent(nav.view, s) ? 'page' : undefined}
          className={`${rowCls(isCurrent(nav.view, s))} ${indent} py-1`}>
          <Avatar name={s.name} size={18} /><span className="truncate flex-1">{s.name}</span><Count n={s.today} muted />
        </button>
      ))}
      {r.sites.length > SHOWN && (
        <button onClick={() => setAll(!all)} className={`${indent} py-1 text-xs text-fc-accent hover:underline`}>
          {all ? nav.t('news.less') : nav.t('news.moreSources', { n: r.sites.length - SHOWN })}
        </button>
      )}
    </>
  )
}

export default function Theme1Sidebar({ nav }: { nav: Nav }) {
  const { t } = nav
  return (
    <nav className="p-2 space-y-0.5">
      <TopButton nav={nav} />
      {nav.groups.map(g => {
        const gid = `g:${g.id}`
        const open = !nav.isFolded(gid, false)
        const Icon = GROUP_ICON[g.id]
        return (
          <div key={g.id} className="pt-2">
            <button onClick={() => nav.toggleFold(gid, false)} aria-expanded={open}
              className="w-full flex items-center gap-1.5 px-1 py-1 text-[11px] font-semibold uppercase tracking-wide text-fc-muted hover:text-white">
              <span className="w-0.5 h-3.5 rounded" style={{ background: GROUP_COLOR[g.id] }} />
              <Icon size={12} aria-hidden /><span className="truncate flex-1 text-left">{t(`news.group.${g.id}`)}</span>
              {g.today > 0 && <span className="normal-case font-normal">{t('news.todayShort', { n: g.today })}</span>}
            </button>
            {open && <Rubrics nav={nav} list={g.rubrics} />}
          </div>
        )
      })}
    </nav>
  )
}

function Rubrics({ nav, list }: { nav: Nav; list: Rubric[] }) {
  const cats = list.map(r => r.cat)
  const { drag, item } = useDrag((id, to) => nav.move(cats, id, to))
  return (
    <>
      {list.map((r, idx) => {
        const open = !nav.isFolded(r.key, true)
        return (
          <div key={r.cat} {...item(r.cat, idx)} className={drag === r.cat ? 'opacity-40' : ''}>
            <div className={`group flex items-center rounded ${isCurrent(nav.view, r) ? 'bg-fc-hover' : 'hover:bg-fc-hover/60'}`} title={nav.t('news.reorder')}>
              <GripVertical size={12} className="text-fc-muted opacity-0 group-hover:opacity-100 flex-shrink-0" aria-hidden />
              <button onClick={() => nav.toggleFold(r.key, true)} aria-expanded={open} aria-label={r.short} className="p-0.5 text-fc-muted hover:text-white">
                <ChevronRight size={13} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
              </button>
              <button onClick={() => nav.pick({ kind: 'category', category: r.cat })}
                onKeyDown={e => { if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); nav.move(cats, r.cat, idx + (e.key === 'ArrowUp' ? -1 : 1)) } }}
                className={`flex-1 min-w-0 flex items-center gap-2 py-1.5 pr-2 text-sm text-left ${isCurrent(nav.view, r) ? 'text-white' : 'text-fc-text'}`}>
                <span className="truncate flex-1">{r.short}</span>
                <span className="text-[10px] text-fc-muted">{r.sites.length}</span>
                <Count n={r.today} />
              </button>
            </div>
            {open && <SiteList nav={nav} r={r} />}
          </div>
        )
      })}
    </>
  )
}
