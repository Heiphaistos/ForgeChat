// Thème 4 : onglets par groupe, segments de rubriques, et panneau « Sources & ordre » (réordonner, couper une source).
import { useState } from 'react'
import { Flame, SlidersHorizontal } from 'lucide-react'
import type { GroupId } from '../newsOrder'
import { currentGroup } from './Theme2Chips'
import { GROUP_COLOR, GROUP_ICON, isCurrent, type Nav } from './shared'

export default function Theme4Tabs({ nav }: { nav: Nav }) {
  const { t, view } = nav
  const [sel, setSel] = useState<GroupId | null>(null)
  const gid = currentGroup(nav) ?? sel
  const group = nav.groups.find(g => g.id === gid)
  const tab = (on: boolean) => `flex-shrink-0 inline-flex items-center gap-1.5 px-3 h-10 text-sm border-b-2 whitespace-nowrap ${on ? 'text-white font-semibold' : 'border-transparent text-fc-muted hover:text-white'}`
  const rubricView = view.kind === 'category' ? view.category : view.kind === 'site' ? view.site.category : null

  return (
    <div className="border-b border-fc-hover">
      <div className="flex items-center gap-1 px-2 border-b border-fc-hover">
        <div className="flex overflow-x-auto min-w-0 flex-1">
          <button className={tab(view.kind === 'top' && !sel)} style={view.kind === 'top' && !sel ? { borderColor: 'rgb(var(--fc-accent-rgb))' } : undefined}
            onClick={() => { setSel(null); nav.pick({ kind: 'top' }) }}>
            <Flame size={14} className="text-orange-400" /> {t('news.top')}
          </button>
          {nav.groups.map(g => {
            const Icon = GROUP_ICON[g.id]
            const on = gid === g.id
            return (
              <button key={g.id} className={tab(on)} style={on ? { borderColor: GROUP_COLOR[g.id] } : undefined}
                onClick={() => { setSel(g.id); const first = g.rubrics[0]; if (first && gid !== g.id) nav.pick({ kind: 'category', category: first.cat }) }}>
                <Icon size={14} aria-hidden /> {t(`news.group.${g.id}`)}
                {g.today > 0 && <span className="text-[10px] font-bold rounded-full px-1.5 text-white" style={{ background: on ? GROUP_COLOR[g.id] : 'rgb(var(--fc-hover-rgb))' }}>{g.today}</span>}
              </button>
            )
          })}
        </div>
        <button onClick={() => nav.openSettings('order')} className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-fc-accent text-white text-xs font-medium">
          <SlidersHorizontal size={13} /> <span className="hidden sm:inline">{t('news.sourcesOrder')}</span>
        </button>
      </div>
      {group && (
        <div className="flex gap-1 overflow-x-auto px-2 py-1.5">
          {group.rubrics.map(r => {
            const on = isCurrent(view, r) || rubricView === r.cat
            return (
              <button key={r.cat} onClick={() => nav.pick({ kind: 'category', category: r.cat })}
                className={`flex-shrink-0 px-3 py-1 rounded-md text-sm whitespace-nowrap ${on ? 'bg-fc-hover text-white font-semibold' : 'text-fc-text hover:bg-fc-hover/60'}`}>
                {r.short} {r.today > 0 && <span className="text-[10px] font-bold text-fc-accent ml-1">{r.today}</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
