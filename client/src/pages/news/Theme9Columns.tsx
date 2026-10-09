// Thèmes 9 et 10 : trois colonnes comme un serveur Discord — genres | sources du genre | articles.
// Le thème 10 réduit les genres à un rail d'icônes. Téléphone : une colonne à la fois
// (genres → sources → articles, avec retour), lisible à 390 px sans feuille ni puces serrées.
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowLeft, ChevronRight, Flame, Layers, Pin, Search, Youtube } from 'lucide-react'
import type { GroupId } from '../newsOrder'
import { Segmented } from './Theme8Tabs'
import { togglePin } from './Theme6Pins'
import { GROUP_COLOR, GROUP_ICON, Avatar, Count, Label, RubricIcon, isCurrent, isFresh, rowCls, useDrag, type Group, type Nav, type Rubric, type Site, type View } from './shared'

/** Genre = une rubrique, sauf YouTube : toutes ses rubriques (« YouTube · <thème> ») n'en font qu'un. */
interface Genre { id: string; label: string; group: GroupId; rubrics: Rubric[]; sites: Site[]; today: number }
type Step = 'genres' | 'sources' | 'feed'

function families(nav: Nav): { g: Group; list: Genre[] }[] {
  const make = (id: string, label: string, group: GroupId, rubrics: Rubric[]): Genre =>
    ({ id, label, group, rubrics, sites: rubrics.flatMap(r => r.sites), today: rubrics.reduce((n, r) => n + r.today, 0) })
  return nav.groups.map(g => ({
    g, list: g.id === 'youtube' ? [make('youtube', nav.t('news.group.youtube'), g.id, g.rubrics)] : g.rubrics.map(r => make(r.key, r.short, g.id, [r])),
  }))
}
const genreView = (x: Genre): View => x.rubrics.length === 1
  ? { kind: 'category', category: x.rubrics[0].cat }
  : { kind: 'genre', id: x.id, label: x.label, categories: x.rubrics.map(r => r.cat) }
function genreOfView(v: View, all: Genre[]): Genre | undefined {
  if (v.kind === 'genre') return all.find(x => x.id === v.id)
  const cat = v.kind === 'category' ? v.category : v.kind === 'site' ? v.site.category : null
  return cat === null ? undefined : all.find(x => x.rubrics.some(r => r.cat === cat))
}
function GenreIcon({ x, size = 15, className = '' }: { x: Genre; size?: number; className?: string }) {
  return x.id === 'youtube' ? <Youtube size={size} className={`flex-shrink-0 ${className}`} aria-hidden /> : <RubricIcon cat={x.rubrics[0].cat} size={size} className={className} />
}

/** Genres d'une famille, réordonnables (glisser ou Alt + flèches) ; liste ou rail selon le thème. */
function Family({ nav, list, cur, rail, onPick }: { nav: Nav; list: Genre[]; cur?: Genre; rail?: boolean; onPick: (x: Genre) => void }) {
  const cats = list.map(x => x.rubrics[0].cat)
  const { drag, item } = useDrag((id, to) => nav.move(cats, id, to))
  return (
    <>
      {list.map((x, idx) => {
        const on = cur?.id === x.id
        const c = x.rubrics[0].cat
        const props = {
          ...(list.length > 1 ? item(c, idx) : {}),
          onClick: () => onPick(x),
          onKeyDown: (e: KeyboardEvent) => { if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); nav.move(cats, c, idx + (e.key === 'ArrowUp' ? -1 : 1)) } },
          'aria-current': on ? ('page' as const) : undefined,
          title: list.length > 1 ? `${x.label} — ${nav.t('news.reorder')}` : x.label,
        }
        if (rail) return (
          <button key={x.id} {...props} className={`group w-full flex flex-col items-center gap-1 py-1 ${drag === c ? 'opacity-40' : ''}`}>
            <span className={`relative w-11 h-11 flex items-center justify-center transition-all ${on ? 'rounded-2xl bg-fc-accent text-white' : 'rounded-full bg-fc-hover/70 text-fc-text group-hover:rounded-2xl group-hover:bg-fc-hover'}`}>
              <GenreIcon x={x} size={19} className={x.id === 'youtube' && !on ? 'text-fc-red' : ''} />
              {x.today > 0 && <span className="absolute -bottom-1 -right-1 text-[9px] font-bold rounded-full px-1 leading-4 bg-fc-accent text-white ring-2 ring-fc-sidebar">{x.today}</span>}
            </span>
            <span className={`w-full px-0.5 text-[10px] leading-tight text-center truncate ${on ? 'text-white font-semibold' : 'text-fc-muted group-hover:text-white'}`}>{x.label}</span>
          </button>
        )
        return (
          <button key={x.id} {...props} className={`${rowCls(on)} ${drag === c ? 'opacity-40' : ''}`}>
            <GenreIcon x={x} className={x.id === 'youtube' ? 'text-fc-red' : 'text-fc-muted'} />
            <span className="truncate flex-1">{x.label}</span>
            <Count n={x.today} muted={!on} />
          </button>
        )
      })}
    </>
  )
}

/** Colonne 1 du thème 9 (et écran « genres » du téléphone) : familles colorées repliables comme le thème 1. */
function GenreList({ nav, fams, cur, onPick, onTop }: { nav: Nav; fams: { g: Group; list: Genre[] }[]; cur?: Genre; onPick: (x: Genre) => void; onTop: () => void }) {
  const { t } = nav
  const top = nav.view.kind === 'top'
  return (
    <nav className="p-2 space-y-0.5" aria-label={t('news.genres')}>
      <button onClick={onTop} aria-current={top ? 'page' : undefined} className={`${rowCls(top)} font-medium`}>
        <Flame size={15} className="text-orange-400" /> {t('news.top')}
      </button>
      {fams.map(({ g, list }) => {
        const gid = `g:${g.id}`
        const open = !nav.isFolded(gid, false)
        const Icon = GROUP_ICON[g.id]
        return (
          <div key={g.id} className="pt-2">
            <button onClick={() => nav.toggleFold(gid, false)} aria-expanded={open}
              className="w-full flex items-center gap-1.5 px-1 py-1 text-[11px] font-semibold uppercase tracking-wide text-fc-muted hover:text-white">
              <ChevronRight size={11} className={`transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
              <span className="w-0.5 h-3.5 rounded" style={{ background: GROUP_COLOR[g.id] }} />
              <Icon size={12} aria-hidden /><span className="truncate flex-1 text-left">{t(`news.group.${g.id}`)}</span>
              {g.today > 0 && <span className="normal-case font-normal">{t('news.todayShort', { n: g.today })}</span>}
            </button>
            {open && <Family nav={nav} list={list} cur={top ? undefined : cur} onPick={onPick} />}
          </div>
        )
      })}
    </nav>
  )
}

/** Colonne 1 du thème 10 : rail d'icônes rondes, libellé court dessous, trait de couleur par famille. */
function GenreRail({ nav, fams, cur, onPick, onTop }: { nav: Nav; fams: { g: Group; list: Genre[] }[]; cur?: Genre; onPick: (x: Genre) => void; onTop: () => void }) {
  const top = nav.view.kind === 'top'
  return (
    <nav className="flex flex-col items-center gap-1 p-1.5 pb-3" aria-label={nav.t('news.genres')}>
      <button onClick={onTop} aria-current={top ? 'page' : undefined} title={nav.t('news.top')} className="group w-full flex flex-col items-center gap-1 py-1">
        <span className={`w-11 h-11 flex items-center justify-center transition-all ${top ? 'rounded-2xl bg-fc-accent' : 'rounded-full bg-fc-hover/70 group-hover:rounded-2xl'}`}>
          <Flame size={19} className={top ? 'text-white' : 'text-orange-400'} />
        </span>
        <span className={`w-full text-[10px] leading-tight text-center truncate ${top ? 'text-white font-semibold' : 'text-fc-muted'}`}>{nav.t('news.topShort')}</span>
      </button>
      {fams.map(({ g, list }) => (
        <div key={g.id} className="w-full flex flex-col items-center gap-1">
          <span className="w-8 h-0.5 my-1 rounded" style={{ background: GROUP_COLOR[g.id] }} title={nav.t(`news.group.${g.id}`)} aria-hidden />
          <Family nav={nav} list={list} cur={top ? undefined : cur} rail onPick={onPick} />
        </div>
      ))}
    </nav>
  )
}

/** Colonne 2 : « Tout <genre> », épinglées, puis les sources (YouTube : par thème ou A-Z). */
function Sources({ nav, x, heading, onGo }: { nav: Nav; x: Genre; heading?: string; onGo: (v: View) => void }) {
  const { t, view } = nav
  const [mode, setMode] = useState<'themes' | 'az'>('themes')
  const [filter, setFilter] = useState('')
  const f = filter.trim().toLowerCase()
  const yt = x.rubrics.length > 1
  const pinned = (s: Site) => nav.prefs.pins.includes(`s:${s.id}`)
  const az = (l: Site[]) => l.filter(s => !f || s.name.toLowerCase().includes(f)).sort((a, b) => a.name.localeCompare(b.name))
  const pins = az(x.sites.filter(pinned))
  const allOn = yt ? view.kind === 'genre' && view.id === x.id : isCurrent(view, x.rubrics[0])

  const row = (s: Site) => {
    const on = isCurrent(view, s)
    const p = pinned(s)
    return (
      <div key={s.id} className={`group flex items-center rounded ${on ? 'bg-fc-hover' : 'hover:bg-fc-hover/60'}`}>
        <button onClick={() => onGo({ kind: 'site', site: s })} aria-current={on ? 'page' : undefined} className="flex-1 min-w-0 flex items-center gap-2.5 pl-2 py-1.5 text-left">
          <Avatar name={s.name} size={32} dot={isFresh(s, nav.seen)} />
          <span className="min-w-0 flex-1">
            <span className={`block truncate text-sm ${on ? 'text-white font-medium' : 'text-fc-text group-hover:text-white'}`}>{s.name}</span>
            <span className="block truncate text-[11px] text-fc-muted">{s.last_title ?? ''}</span>
          </span>
          <Count n={s.today} muted />
        </button>
        <button onClick={() => togglePin(nav, `s:${s.id}`)} aria-pressed={p} aria-label={`${p ? t('news.unpin') : t('news.pin')} ${s.name}`} title={p ? t('news.unpin') : t('news.pin')}
          className={`p-1.5 mr-0.5 rounded hover:text-white ${p ? 'text-fc-accent' : 'text-fc-muted md:opacity-0 md:group-hover:opacity-100 focus:opacity-100'}`}><Pin size={13} /></button>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-3 pt-3 pb-2 flex flex-col gap-2 border-b border-fc-hover flex-shrink-0">
        {heading && <h2 className="hidden md:flex items-center gap-2 text-white font-semibold"><GenreIcon x={x} size={16} className={yt ? 'text-fc-red' : ''} /><span className="truncate">{heading}</span></h2>}
        <p className="text-xs text-fc-muted truncate">
          {t(yt ? 'news.nChannels' : 'news.nSources', { n: x.sites.length })}{yt && ` · ${t('news.nThemes', { n: x.rubrics.length })}`} · {t('news.todayShort', { n: x.today })}
        </p>
        {yt && <Segmented value={mode} onChange={setMode} items={[['themes', t('news.byTheme')], ['az', t('news.az')]]} />}
        {x.sites.length > 6 && (
          <label className="relative block">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-fc-muted" aria-hidden />
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder={t('news.filter')} aria-label={t('news.filter')}
              className="w-full pl-7 pr-2 py-1 bg-fc-input rounded-md text-sm text-white outline-none focus:ring-2 focus:ring-fc-accent" />
          </label>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-0.5">
        <button onClick={() => onGo(genreView(x))} aria-current={allOn ? 'page' : undefined} className={`${rowCls(allOn)} font-medium`}>
          <span className="w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center text-white" style={{ background: GROUP_COLOR[x.group] }}><Layers size={15} aria-hidden /></span>
          <span className="truncate flex-1">{t('news.allOf', { name: x.label })}</span>
          <Count n={x.today} />
        </button>
        {pins.length > 0 && <><Label>{t('news.pinned')}</Label>{pins.map(row)}</>}
        {yt && mode === 'themes'
          ? x.rubrics.map(r => {
            const list = az(r.sites.filter(s => !pinned(s)))
            if (!list.length) return null
            const on = isCurrent(view, r)
            return (
              <div key={r.cat}>
                <button onClick={() => onGo({ kind: 'category', category: r.cat })} aria-current={on ? 'page' : undefined}
                  className={`w-full flex items-center gap-1.5 px-2 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-left ${on ? 'text-white' : 'text-fc-muted hover:text-white'}`}>
                  <RubricIcon cat={r.cat} size={12} /><span className="truncate flex-1">{r.short}</span>
                  <span className="normal-case tracking-normal font-normal">{list.length}</span>
                </button>
                {list.map(row)}
              </div>
            )
          })
          : <>{pins.length > 0 && <Label>{t('news.sourcesTitle')}</Label>}{az(x.sites.filter(s => !pinned(s))).map(row)}</>}
      </div>
    </div>
  )
}

export default function Theme9Columns({ nav, compact, title, main }: { nav: Nav; compact: boolean; title: ReactNode; main: (lead?: ReactNode) => ReactNode }) {
  const { t } = nav
  const fams = families(nav)
  const all = fams.flatMap(f => f.list)
  const [sel, setSel] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('genres')
  const cur = genreOfView(nav.view, all) ?? all.find(x => x.id === sel) ?? all[0]
  const pickGenre = (x: Genre) => { setSel(x.id); nav.pick(genreView(x)); setStep('sources') }
  const go = (v: View) => { nav.pick(v); setStep('feed') }
  const onTop = () => go({ kind: 'top' })
  const show = (s: Step) => (step === s ? 'flex' : 'hidden')
  const backBtn = (to: Step, label: string) => (
    <button onClick={() => setStep(to)} aria-label={t('news.back')} className="md:hidden flex-shrink-0 flex items-center gap-1.5 min-w-0 max-w-[45%] -ml-1 px-1 py-1 rounded text-white hover:bg-fc-hover">
      <ArrowLeft size={18} className="flex-shrink-0" /><span className="truncate text-sm font-semibold">{label}</span>
    </button>
  )
  const genreTitle = cur && (
    <h2 className="flex items-center gap-2 min-w-0 text-white font-semibold">
      <GenreIcon x={cur} size={16} className={cur.id === 'youtube' ? 'text-fc-red' : 'text-fc-muted'} /><span className="truncate">{cur.label}</span>
    </h2>
  )
  const list = <GenreList nav={nav} fams={fams} cur={cur} onPick={pickGenre} onTop={onTop} />

  return (
    <>
      {/* Colonne 1 : genres (liste ou rail) ; au téléphone, premier écran. */}
      {compact && (
        <aside className="hidden md:flex md:flex-col w-[84px] flex-shrink-0 border-r border-fc-hover bg-fc-sidebar min-h-0 overflow-y-auto" aria-label={t('news.genres')}>
          <GenreRail nav={nav} fams={fams} cur={cur} onPick={pickGenre} onTop={onTop} />
        </aside>
      )}
      <aside className={`${show('genres')} ${compact ? 'md:hidden' : 'md:flex md:w-56'} w-full flex-col flex-shrink-0 border-r border-fc-hover bg-fc-sidebar min-h-0`} aria-label={t('news.genres')}>
        <div className="flex items-center px-4 h-12 border-b border-fc-hover flex-shrink-0">{title}</div>
        <div className="flex-1 min-h-0 overflow-y-auto">{list}</div>
      </aside>

      {/* Colonne 2 : sources du genre, dans l'espace que laissait le fil centré. */}
      {cur && (
        <section className={`${show('sources')} md:flex w-full md:w-72 xl:w-80 2xl:w-96 flex-col flex-shrink-0 border-r border-fc-hover bg-fc-channel min-h-0`} aria-label={t('news.sites')}>
          <div className="flex items-center gap-2 px-3 h-12 border-b border-fc-hover flex-shrink-0">
            {backBtn('genres', t('news.genres'))}
            {compact ? <><div className="md:hidden min-w-0">{genreTitle}</div><div className="hidden md:block min-w-0">{title}</div></> : genreTitle}
          </div>
          <Sources key={cur.id} nav={nav} x={cur} heading={compact ? cur.label : undefined} onGo={go} />
        </section>
      )}

      {/* Colonne 3 : les articles (fil et cartes communs à tous les thèmes). */}
      <div className={`${show('feed')} md:flex flex-1 min-w-0 min-h-0`}>
        {main(backBtn(nav.view.kind === 'top' ? 'genres' : 'sources', nav.view.kind === 'top' ? t('news.genres') : cur?.label ?? ''))}
      </div>
    </>
  )
}
