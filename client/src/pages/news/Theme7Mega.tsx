// Thème 7 : méga-menu « Rubriques ▾ » plein largeur, une colonne par groupe, sources de la rubrique survolée en bas.
import { useEffect, useState } from 'react'
import { ChevronDown, GripVertical, LayoutGrid } from 'lucide-react'
import { GROUP_COLOR, GROUP_ICON, Avatar, RubricIcon, isCurrent, useDrag, type Group, type Nav, type Rubric } from './shared'

export default function Theme7Mega({ nav }: { nav: Nav }) {
  const { t } = nav
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState<Rubric | null>(null)
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open])
  const go = (v: Parameters<Nav['pick']>[0]) => { nav.pick(v); setOpen(false) }
  const viewCat = nav.view.kind === 'category' ? nav.view.category : nav.view.kind === 'site' ? nav.view.site.category : null
  const shown = hover ?? nav.rubrics.find(r => r.cat === viewCat) ?? null
  const sources = nav.rubrics.reduce((n, r) => n + r.sites.length, 0)

  return (
    <>
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="true"
        className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-fc-accent text-white text-sm font-medium">
        <LayoutGrid size={14} /> <span className="hidden sm:inline">{t('news.rubrics')}</span> <ChevronDown size={14} className={open ? 'rotate-180' : ''} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setOpen(false)} aria-hidden />
          <div className="fixed md:absolute left-0 right-0 top-12 bottom-0 md:bottom-auto md:left-4 md:right-4 md:top-full md:mt-1 z-50 md:max-h-[75vh] overflow-y-auto bg-fc-channel border border-fc-hover md:rounded-xl shadow-2xl" role="dialog" aria-label={t('news.allRubrics')}>
            <div className="flex items-baseline gap-2 flex-wrap px-4 py-3 border-b border-fc-hover">
              <h2 className="text-white font-semibold">{t('news.allRubrics')}</h2>
              <span className="text-xs text-fc-muted">{t('news.nRubrics', { n: nav.rubrics.length })} · {t('news.nSources', { n: sources })}</span>
              <span className="ml-auto hidden md:inline text-xs text-fc-muted">{t('news.megaHint')}</span>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3 p-3">
              {nav.groups.map(g => <Column key={g.id} nav={nav} g={g} go={go} onHover={setHover} />)}
            </div>
            {shown && (
              <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 border-t border-fc-hover">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-white"><RubricIcon cat={shown.cat} size={14} /> {shown.short}</span>
                <span className="text-xs text-fc-muted">{t('news.nSources', { n: shown.sites.length })} :</span>
                {shown.sites.slice(0, 6).map(s => (
                  <button key={s.id} onClick={() => go({ kind: 'site', site: s })} className="inline-flex items-center gap-1.5 pl-1 pr-2.5 py-0.5 rounded-full border border-fc-hover text-xs text-fc-text hover:text-white">
                    <Avatar name={s.name} size={18} /> {s.name}
                  </button>
                ))}
                {shown.sites.length > 6 && <span className="text-xs text-fc-muted">+{shown.sites.length - 6}</span>}
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}

function Column({ nav, g, go, onHover }: { nav: Nav; g: Group; go: (v: Parameters<Nav['pick']>[0]) => void; onHover: (r: Rubric) => void }) {
  const { t } = nav
  const cats = g.rubrics.map(r => r.cat)
  const { drag, item } = useDrag((id, to) => nav.move(cats, id, to))
  const Icon = GROUP_ICON[g.id]
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 px-1 pb-1.5 mb-1 border-b border-fc-hover">
        <span className="w-5 h-5 rounded-md inline-flex items-center justify-center text-white" style={{ background: GROUP_COLOR[g.id] }}><Icon size={12} aria-hidden /></span>
        <span className="flex-1 truncate text-sm font-semibold text-white">{t(`news.group.${g.id}`)}</span>
        {g.today > 0 && <span className="text-[10px] text-fc-muted">{t('news.todayShort', { n: g.today })}</span>}
      </div>
      {g.rubrics.map((r, idx) => (
        <button key={r.cat} {...item(r.cat, idx)} onMouseEnter={() => onHover(r)} onFocus={() => onHover(r)} onClick={() => go({ kind: 'category', category: r.cat })}
          className={`group w-full flex items-center gap-2 px-1.5 py-1.5 rounded text-sm text-left ${isCurrent(nav.view, r) ? 'bg-fc-hover text-white ring-1 ring-fc-accent' : 'text-fc-text hover:bg-fc-hover/60'} ${drag === r.cat ? 'opacity-40' : ''}`}>
          <GripVertical size={11} className="text-fc-muted opacity-0 group-hover:opacity-100 flex-shrink-0 hidden md:block" aria-hidden />
          <RubricIcon cat={r.cat} size={14} className="text-fc-muted" />
          <span className="truncate flex-1">{r.short}</span>
          <span className="text-[10px] text-fc-muted flex-shrink-0">{t('news.nSrc', { n: r.sites.length })}</span>
          <span className="w-6 text-right text-[10px] font-bold text-fc-accent flex-shrink-0">{r.today || ''}</span>
        </button>
      ))}
    </div>
  )
}
