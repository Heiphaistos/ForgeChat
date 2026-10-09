// Thème 3 : grille de tuiles de rubriques (icône, articles du jour, sources) ; un clic ouvre les articles.
import { GripVertical, LayoutGrid } from 'lucide-react'
import { GROUP_COLOR, Avatars, RubricBadge, useDrag, type Group, type Nav } from './shared'

export default function Theme3Tiles({ nav }: { nav: Nav }) {
  const { t } = nav
  // Hors « À la une » : un simple retour vers la grille, les articles prennent la place.
  if (nav.view.kind !== 'top') {
    return (
      <div className="px-4 pt-3">
        <button onClick={() => nav.pick({ kind: 'top' })} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fc-hover text-sm text-white hover:bg-fc-accent">
          <LayoutGrid size={14} /> {t('news.rubrics')}
        </button>
      </div>
    )
  }
  const sources = nav.rubrics.reduce((n, r) => n + r.sites.length, 0)
  const today = nav.rubrics.reduce((n, r) => n + r.today, 0)
  return (
    <section className="max-w-6xl mx-auto px-4 md:px-6 pt-5 space-y-4">
      <header className="flex items-baseline gap-3 flex-wrap">
        <h2 className="text-2xl font-bold text-white">{t('news.rubrics')}</h2>
        <span className="text-sm text-fc-muted">{t('news.stats', { r: nav.rubrics.length, s: sources, a: today })}</span>
      </header>
      {nav.groups.map(g => <Tiles key={g.id} nav={nav} g={g} />)}
    </section>
  )
}

function Tiles({ nav, g }: { nav: Nav; g: Group }) {
  const { t } = nav
  const cats = g.rubrics.map(r => r.cat)
  const { drag, item } = useDrag((id, to) => nav.move(cats, id, to))
  return (
    <div>
      <h3 className="flex items-center gap-2 mb-2 text-[11px] font-semibold uppercase tracking-wide text-fc-muted">
        <span className="w-0.5 h-3.5 rounded" style={{ background: GROUP_COLOR[g.id] }} />{t(`news.group.${g.id}`)}
      </h3>
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(190px,1fr))]">
        {g.rubrics.map((r, idx) => (
          <button key={r.cat} {...item(r.cat, idx)} onClick={() => nav.pick({ kind: 'category', category: r.cat })} title={t('news.reorder')}
            className={`group text-left rounded-xl bg-fc-channel border border-fc-hover hover:border-fc-accent/60 p-3 space-y-2 min-w-0 ${drag === r.cat ? 'opacity-40' : ''}`}>
            <span className="flex items-center gap-2 min-w-0">
              <RubricBadge r={r} size={26} /><span className="font-semibold text-white text-sm leading-tight line-clamp-2 break-words flex-1">{r.short}</span>
              <GripVertical size={12} className="text-fc-muted opacity-0 group-hover:opacity-100 hidden md:block" aria-hidden />
            </span>
            <span className="block text-xs text-fc-muted truncate"><b className="text-lg text-white mr-1">{r.today}</b>{t('news.articlesToday')}</span>
            <span className="flex items-center gap-2 text-[11px] text-fc-muted min-w-0">
              <Avatars sites={r.sites} n={4} size={18} /><span className="truncate">{t('news.nSources', { n: r.sites.length })}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
