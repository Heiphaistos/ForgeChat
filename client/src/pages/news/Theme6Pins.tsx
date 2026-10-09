// Thème 6 (par défaut) : Épinglées (tri libre, rubriques et sites mélangés) + Dossiers repliables par groupe,
// avec l'onglet YouTube à avatars du thème 8.
import { useState } from 'react'
import { ChevronDown, ChevronRight, GripVertical, Pin, PinOff } from 'lucide-react'
import { TopButton } from './Theme1Sidebar'
import { Segmented, YouTubeTab } from './Theme8Tabs'
import { GROUP_COLOR, GROUP_ICON, Avatar, Avatars, Count, Label, RubricBadge, isCurrent, useDrag, type Nav, type Rubric, type Site } from './shared'

/** Épingle ou retire une rubrique (« c:<clé> ») ou un site (« s:<id> »). */
export function togglePin(nav: Nav, id: string) {
  const pins = nav.prefs.pins
  nav.update({ pins: pins.includes(id) ? pins.filter(p => p !== id) : [...pins, id] })
}

function Pins({ nav }: { nav: Nav }) {
  const { t, prefs } = nav
  const byKey = new Map(nav.rubrics.map(r => [`c:${r.key}`, r]))
  const byId = new Map(nav.sites.map(s => [`s:${s.id}`, s]))
  const items = prefs.pins.map(id => [id, byKey.get(id) ?? byId.get(id)] as const).filter((x): x is readonly [string, Rubric | Site] => !!x[1])
  const ids = items.map(([id]) => id)
  const { drag, item } = useDrag((id, to) => {
    const rest = ids.filter(x => x !== id)
    rest.splice(to, 0, id)
    // Les épinglées introuvables (site coupé, rubrique disparue) restent mémorisées, en fin de liste.
    nav.update({ pins: [...rest, ...prefs.pins.filter(p => !ids.includes(p))] })
  })
  return (
    <>
      <Label right={items.length > 1 ? t('news.dragToSort') : undefined}><Pin size={11} className="inline mr-1" />{t('news.pinned')}</Label>
      {!items.length && <p className="px-2 pb-1 text-xs text-fc-muted">{t('news.pinHint')}</p>}
      {items.map(([id, x], idx) => {
        const on = isCurrent(nav.view, x)
        return (
          <div key={id} {...item(id, idx)} className={`group flex items-center rounded ${drag === id ? 'opacity-40' : ''} ${on ? 'bg-fc-hover' : 'hover:bg-fc-hover/60'}`}>
            <GripVertical size={12} className="ml-0.5 text-fc-muted flex-shrink-0" aria-hidden />
            <button onClick={() => nav.pick('cat' in x ? { kind: 'category', category: x.cat } : { kind: 'site', site: x })}
              className={`flex-1 min-w-0 flex items-center gap-2 px-1.5 py-1.5 text-sm text-left ${on ? 'text-white' : 'text-fc-text'}`}>
              {'cat' in x ? <RubricBadge r={x} size={20} /> : <Avatar name={x.name} size={20} />}
              <span className="truncate flex-1">{'cat' in x ? clean6(x) : x.name}</span>
              <Count n={x.today} />
            </button>
            <button onClick={() => togglePin(nav, id)} aria-label={t('news.unpin')} title={t('news.unpin')} className="px-1.5 text-fc-muted hover:text-white opacity-0 group-hover:opacity-100 focus:opacity-100">
              <PinOff size={13} />
            </button>
          </div>
        )
      })}
    </>
  )
}
/** Rubrique YouTube épinglée : « YouTube · <thème> » pour la distinguer de la rubrique homonyme. */
const clean6 = (r: Rubric) => (r.group === 'youtube' ? `YouTube · ${r.short}` : r.short)

function Folders({ nav }: { nav: Nav }) {
  const { t } = nav
  return (
    <>
      <Label>{t('news.folders')}</Label>
      <div className="space-y-1.5">
        {nav.groups.map(g => {
          const id = `g:${g.id}`
          const open = !nav.isFolded(id, true)
          const Icon = GROUP_ICON[g.id]
          return (
            <div key={g.id} className="rounded-lg border border-fc-hover overflow-hidden">
              <button onClick={() => nav.toggleFold(id, true)} aria-expanded={open} className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-fc-hover/60">
                <Icon size={15} style={{ color: GROUP_COLOR[g.id] }} aria-hidden />
                <span className="flex-1 truncate text-sm font-semibold text-white">{t(`news.group.${g.id}`)}</span>
                <span className="text-[10px] text-fc-muted">{t('news.nRubrics', { n: g.rubrics.length })}</span>
                <Count n={g.today} />
                {open ? <ChevronDown size={14} className="text-fc-muted" /> : <ChevronRight size={14} className="text-fc-muted" />}
              </button>
              {open && g.rubrics.map(r => {
                const pinned = nav.prefs.pins.includes(`c:${r.key}`)
                return (
                  <div key={r.cat} className={`group flex items-center border-l-2 ${isCurrent(nav.view, r) ? 'bg-fc-hover' : 'hover:bg-fc-hover/60'}`} style={{ borderColor: GROUP_COLOR[g.id] }}>
                    <button onClick={() => nav.pick({ kind: 'category', category: r.cat })} className="flex-1 min-w-0 flex items-center gap-2 pl-2.5 py-1.5 text-sm text-left text-fc-text">
                      <span className="truncate flex-1">{r.short}</span>
                      <Avatars sites={r.sites} n={3} size={16} />
                      <span className="w-6 text-right text-[10px] font-bold text-fc-accent">{r.today || ''}</span>
                    </button>
                    <button onClick={() => togglePin(nav, `c:${r.key}`)} aria-pressed={pinned} aria-label={pinned ? t('news.unpin') : t('news.pin')} title={pinned ? t('news.unpin') : t('news.pin')}
                      className={`px-1.5 ${pinned ? 'text-fc-accent' : 'text-fc-muted opacity-0 group-hover:opacity-100 focus:opacity-100'} hover:text-white`}>
                      <Pin size={12} />
                    </button>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </>
  )
}

export default function Theme6Pins({ nav }: { nav: Nav }) {
  const { t } = nav
  const [tab, setTab] = useState<'folders' | 'youtube'>('folders')
  return (
    <nav className="p-2 space-y-1">
      <TopButton nav={nav} />
      <Segmented value={tab} onChange={setTab} items={[['folders', t('news.rubrics')], ['youtube', 'YouTube', true]]} />
      {tab === 'folders' ? <><Pins nav={nav} /><Folders nav={nav} /></> : <div className="pt-1"><YouTubeTab nav={nav} /></div>}
    </nav>
  )
}
