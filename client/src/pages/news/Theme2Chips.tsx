// Thème 2 : bandeau de puces sans barre latérale — groupes, puis rubriques du groupe, puis sources de la rubrique.
import { useState, type ReactNode } from 'react'
import { Flame, GripVertical } from 'lucide-react'
import { groupOf, type GroupId } from '../newsOrder'
import { GROUP_COLOR, GROUP_ICON, Avatar, RubricIcon, isCurrent, useDrag, type Nav } from './shared'

const chip = (on: boolean) =>
  `flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm border whitespace-nowrap ${on ? 'border-fc-accent bg-fc-accent/15 text-white' : 'border-fc-hover bg-fc-channel text-fc-text hover:text-white'}`
const num = 'text-[10px] font-bold text-fc-accent'

/** Groupe de la vue courante (rubrique ou site), sinon le choix local. */
export function currentGroup(nav: Nav): GroupId | null {
  if (nav.view.kind === 'category') return groupOf(nav.view.category)
  if (nav.view.kind === 'site') return groupOf(nav.view.site.category)
  return null
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="hidden sm:block w-24 flex-shrink-0 text-[11px] font-semibold uppercase tracking-wide text-fc-muted truncate">{label}</span>
      <div className="flex gap-2 overflow-x-auto md:flex-wrap min-w-0 pb-0.5">{children}</div>
    </div>
  )
}

export default function Theme2Chips({ nav }: { nav: Nav }) {
  const { t, view } = nav
  const [sel, setSel] = useState<GroupId | null>(null)
  const gid = currentGroup(nav) ?? sel
  const group = nav.groups.find(g => g.id === gid)
  const rubric = view.kind === 'category' ? nav.rubrics.find(r => r.cat === view.category)
    : view.kind === 'site' ? nav.rubrics.find(r => r.cat === view.site.category) : undefined
  const cats = group?.rubrics.map(r => r.cat) ?? []
  const { drag, item } = useDrag((id, to) => nav.move(cats, id, to))

  return (
    <div className="px-4 py-2 space-y-2 border-b border-fc-hover">
      <div className="flex gap-2 overflow-x-auto md:flex-wrap pb-0.5">
        <button className={chip(view.kind === 'top' && !sel)} onClick={() => { setSel(null); nav.pick({ kind: 'top' }) }}>
          <Flame size={14} className="text-orange-400" /> {t('news.top')}
        </button>
        {nav.groups.map(g => {
          const Icon = GROUP_ICON[g.id]
          const on = gid === g.id
          return (
            <button key={g.id} className={chip(on)} style={on ? { borderColor: GROUP_COLOR[g.id], background: GROUP_COLOR[g.id] } : undefined}
              onClick={() => { setSel(g.id); if (gid !== g.id && view.kind !== 'top') nav.pick({ kind: 'top' }) }}>
              <Icon size={14} aria-hidden /> {t(`news.group.${g.id}`)} {g.today > 0 && <span className={on ? 'text-[10px] font-bold' : num}>{g.today}</span>}
            </button>
          )
        })}
      </div>
      {group && (
        <Row label={t('news.rubrics')}>
          {group.rubrics.map((r, idx) => (
            <button key={r.cat} {...item(r.cat, idx)} className={`${chip(isCurrent(view, r) || rubric?.cat === r.cat)} rounded-lg ${drag === r.cat ? 'opacity-40' : ''}`}
              onClick={() => nav.pick({ kind: 'category', category: r.cat })} title={t('news.reorder')}>
              <GripVertical size={12} className="text-fc-muted hidden md:block" aria-hidden />
              <RubricIcon cat={r.cat} size={14} /> {r.short} {r.today > 0 && <span className={num}>{r.today}</span>}
            </button>
          ))}
        </Row>
      )}
      {rubric && (
        <Row label={t('news.nSources', { n: rubric.sites.length })}>
          {rubric.sites.map(s => (
            <button key={s.id} className={`${chip(isCurrent(view, s))} pl-1`} onClick={() => nav.pick({ kind: 'site', site: s })}>
              <Avatar name={s.name} size={20} /> {s.name} {s.today > 0 && <span className={num}>{s.today}</span>}
            </button>
          ))}
        </Row>
      )}
    </div>
  )
}
