// Panneau de la molette : choix du thème de navigation et personnalisation (épinglées, ordre, sources coupées, groupes).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, Pin, PinOff, RotateCcw, Settings2, X } from 'lucide-react'
import { groupOf, short } from '../newsOrder'
import { togglePin } from './Theme6Pins'
import { GROUP_COLOR, Avatar, UpDown, useDrag, type Nav, type Site } from './shared'
import { DEFAULT_THEME, THEMES, type ThemeId } from './useNewsPrefs'

/** Aperçu schématique d'un thème (quelques blocs, couleurs du thème de l'app). */
function Mini({ id }: { id: ThemeId }) {
  const b = (cls: string, k?: number) => <span key={k} className={`block rounded-sm bg-fc-hover ${cls}`} />
  const a = (cls: string, k?: number) => <span key={k} className={`block rounded-sm bg-fc-accent/70 ${cls}`} />
  const cards = <span className="flex-1 grid grid-cols-2 gap-0.5 p-0.5">{[0, 1, 2, 3].map(i => b('h-full', i))}</span>
  const side = (inner: ReactNode, w = 'w-7') => <span className={`${w} flex flex-col gap-0.5 p-0.5 border-r border-fc-hover`}>{inner}</span>
  const body: Record<ThemeId, ReactNode> = {
    1: <>{side(<>{a('h-0.5 w-3')}{b('h-1')}{b('h-1 ml-1')}{b('h-1 ml-1')}{a('h-0.5 w-3 mt-0.5')}{b('h-1')}{b('h-1')}</>)}{cards}</>,
    2: <span className="flex-1 flex flex-col gap-0.5 p-0.5"><span className="flex gap-0.5">{a('h-1.5 w-4')}{b('h-1.5 w-4')}{b('h-1.5 w-4')}</span><span className="flex gap-0.5">{b('h-1.5 w-5')}{b('h-1.5 w-5')}</span><span className="flex gap-0.5">{b('h-1.5 w-3')}{b('h-1.5 w-3')}{b('h-1.5 w-3')}</span>{cards}</span>,
    3: <span className="flex-1 grid grid-cols-4 gap-0.5 p-0.5">{[0, 1, 2, 3, 4, 5, 6, 7].map(i => (i === 1 ? a('h-3', i) : b('h-3', i)))}</span>,
    4: <span className="flex-1 flex flex-col"><span className="flex gap-1 p-0.5 border-b border-fc-hover">{a('h-1 w-4')}{b('h-1 w-4')}{b('h-1 w-4')}</span><span className="flex flex-1">{cards}{side(<>{b('h-1')}{b('h-1')}{b('h-1')}</>, 'w-6 border-l')}</span></span>,
    5: <>{side(<>{[0, 1, 2, 3].map(i => <span key={i} className={`block w-2.5 h-2.5 rounded-full ${i === 1 ? 'bg-fc-accent/70' : 'bg-fc-hover'}`} />)}</>, 'w-4 items-center')}{side(<>{b('h-1')}{b('h-1')}{b('h-1')}{b('h-1')}</>)}{cards}</>,
    6: <>{side(<>{b('h-1')}{a('h-1')}{a('h-1')}<span className="block h-1" />{b('h-2 border border-fc-hover')}{b('h-2')}</>)}{cards}</>,
    7: <span className="flex-1 flex flex-col gap-0.5 p-0.5">{a('h-1.5 w-6')}<span className="flex-1 grid grid-cols-4 gap-0.5 p-0.5 rounded-sm border border-fc-hover">{[0, 1, 2, 3].map(i => <span key={i} className="flex flex-col gap-0.5">{b('h-0.5')}{b('h-0.5')}{b('h-0.5')}</span>)}</span></span>,
    8: <>{side(<><span className="flex gap-0.5">{b('h-1 flex-1')}{a('h-1 flex-1')}{b('h-1 flex-1')}</span><span className="flex gap-0.5">{[0, 1, 2].map(i => <span key={i} className="block w-1.5 h-1.5 rounded-full bg-fc-hover" />)}</span><span className="flex gap-0.5">{[0, 1, 2].map(i => <span key={i} className="block w-1.5 h-1.5 rounded-full bg-fc-hover" />)}</span></>, 'w-8')}{cards}</>,
    9: <>{side(<>{a('h-0.5 w-3')}{b('h-1')}{a('h-1')}{a('h-0.5 w-3 mt-0.5')}{b('h-1')}{b('h-1')}</>, 'w-6')}{side(<>{a('h-1')}{[0, 1, 2, 3].map(i => <span key={i} className="flex items-center gap-0.5"><span className="block w-1.5 h-1.5 rounded-full bg-fc-hover flex-shrink-0" />{b('h-1 flex-1')}</span>)}</>, 'w-8')}{cards}</>,
    10: <>{side(<>{[0, 1, 2, 3].map(i => <span key={i} className={`block w-2.5 h-2.5 rounded-full ${i === 1 ? 'bg-fc-accent/70' : 'bg-fc-hover'}`} />)}</>, 'w-4 items-center')}{side(<>{a('h-1')}{[0, 1, 2, 3].map(i => <span key={i} className="flex items-center gap-0.5"><span className="block w-1.5 h-1.5 rounded-full bg-fc-hover flex-shrink-0" />{b('h-1 flex-1')}</span>)}</>, 'w-10')}{cards}</>,
  }
  return <span className="flex h-12 rounded-md border border-fc-hover bg-fc-chat overflow-hidden" aria-hidden>{body[id]}</span>
}

function Section({ id, title, right, children }: { id: string; title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="space-y-2 scroll-mt-2">
      <h3 className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide text-fc-muted">{title}{right}</h3>
      {children}
    </section>
  )
}

const small = 'inline-flex items-center gap-1 px-2 py-1 rounded-md bg-fc-hover text-xs text-fc-text hover:text-white normal-case tracking-normal font-normal'

export default function NewsSettings({ nav, all, section, onClose }: { nav: Nav; all: Site[]; section?: 'order' | 'sources'; onClose: () => void }) {
  const { t, prefs, update } = nav
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (section) box.current?.querySelector(`#news-set-${section}`)?.scrollIntoView()
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [section, onClose])

  // Rubrique dont on règle les sources : celle affichée, sinon la première.
  const viewCat = nav.view.kind === 'category' ? nav.view.category : nav.view.kind === 'site' ? nav.view.site.category : null
  const cats = useMemo(() => nav.rubrics.map(r => r.cat), [nav.rubrics])
  const allCats = useMemo(() => [...new Set([...cats, ...all.map(s => s.category)])], [cats, all])
  const [srcCat, setSrcCat] = useState(() => viewCat ?? cats[0] ?? '')
  const srcSites = all.filter(s => s.category === srcCat).sort((a, b) => a.name.localeCompare(b.name))
  const { drag, item } = useDrag((id, to) => nav.move(cats, id, to))
  const pinned = (id: string) => prefs.pins.includes(id)
  const label = (id: string) => {
    if (id.startsWith('s:')) return all.find(s => s.id === id.slice(2))?.name
    const r = nav.rubrics.find(x => `c:${x.key}` === id)
    return r && (r.group === 'youtube' ? `YouTube · ${r.short}` : r.short)
  }
  const pins = prefs.pins.filter(label)
  const movePin = (id: string, to: number) => { const rest = pins.filter(p => p !== id); rest.splice(to, 0, id); update({ pins: rest }) }
  const foldAll = (v: boolean) => update({ folded: Object.fromEntries([...nav.groups.map(g => `g:${g.id}`), ...nav.rubrics.map(r => r.key)].map(k => [k, v])) })

  return createPortal(
    <div className="fixed inset-0 z-[70] flex md:justify-end items-end md:items-stretch" role="dialog" aria-modal="true" aria-label={t('news.customize')}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div ref={box} className="relative w-full md:w-[440px] max-h-[88vh] md:max-h-none flex flex-col bg-fc-channel border-t md:border-t-0 md:border-l border-fc-hover rounded-t-2xl md:rounded-none shadow-2xl">
        <header className="flex items-center gap-2 px-4 h-12 border-b border-fc-hover flex-shrink-0">
          <Settings2 size={16} className="text-fc-muted" /><h2 className="flex-1 text-white font-semibold">{t('news.customize')}</h2>
          <button onClick={onClose} aria-label={t('news.close')} className="p-1 rounded text-fc-muted hover:text-white"><X size={18} /></button>
        </header>
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <Section id="news-set-theme" title={t('news.theme')}>
            <div className="grid grid-cols-2 gap-2">
              {THEMES.map(id => {
                const on = prefs.theme === id
                return (
                  <button key={id} onClick={() => update({ theme: id })} aria-pressed={on}
                    className={`text-left rounded-lg border p-2 space-y-1.5 ${on ? 'border-fc-accent bg-fc-accent/10' : 'border-fc-hover hover:border-fc-accent/50'}`}>
                    <Mini id={id} />
                    <span className="flex items-center gap-1 text-sm font-semibold text-white">
                      <span className="text-fc-muted">{id}.</span> <span className="truncate flex-1">{t(`news.theme${id}`)}</span>
                      {on && <Check size={14} className="text-fc-accent flex-shrink-0" />}
                    </span>
                    <span className="block text-[11px] leading-snug text-fc-muted">{t(`news.theme${id}.desc`)}{id === DEFAULT_THEME && ` ${t('news.defaultTag')}`}</span>
                  </button>
                )
              })}
            </div>
          </Section>

          <Section id="news-set-pins" title={t('news.pinned')}>
            {!pins.length && <p className="text-xs text-fc-muted">{t('news.pinHint')}</p>}
            {pins.map((id, idx) => (
              <div key={id} className="flex items-center gap-2 px-2 py-1 rounded bg-fc-chat text-sm text-fc-text">
                <Pin size={12} className="text-fc-accent flex-shrink-0" /><span className="flex-1 truncate">{label(id)}</span>
                <UpDown label={label(id) ?? ''} onUp={idx > 0 ? () => movePin(id, idx - 1) : undefined} onDown={idx < pins.length - 1 ? () => movePin(id, idx + 1) : undefined} />
                <button onClick={() => togglePin(nav, id)} aria-label={t('news.unpin')} className="p-1 text-fc-muted hover:text-white"><PinOff size={13} /></button>
              </div>
            ))}
          </Section>

          <Section id="news-set-order" title={t('news.order')} right={<button className={small} onClick={() => update({ order: [] })}><RotateCcw size={11} /> {t('news.defaultOrder')}</button>}>
            <div className="space-y-1">
              {nav.rubrics.map((r, idx) => (
                <div key={r.cat} {...item(r.cat, idx)} className={`flex items-center gap-2 px-2 py-1 rounded bg-fc-chat text-sm text-fc-text cursor-grab ${drag === r.cat ? 'opacity-40' : ''}`}>
                  <span className="w-12 flex-shrink-0 text-center text-[9px] font-bold uppercase rounded px-1 text-white truncate" style={{ background: GROUP_COLOR[r.group] }}>{t(`news.groupTag.${r.group}`)}</span>
                  <span className="flex-1 truncate">{r.short}</span>
                  <button onClick={() => togglePin(nav, `c:${r.key}`)} aria-pressed={pinned(`c:${r.key}`)} aria-label={pinned(`c:${r.key}`) ? t('news.unpin') : t('news.pin')}
                    className={`p-1 ${pinned(`c:${r.key}`) ? 'text-fc-accent' : 'text-fc-muted'} hover:text-white`}><Pin size={12} /></button>
                  <UpDown label={r.short} onUp={idx > 0 ? () => nav.move(cats, r.cat, idx - 1) : undefined} onDown={idx < cats.length - 1 ? () => nav.move(cats, r.cat, idx + 1) : undefined} />
                </div>
              ))}
            </div>
          </Section>

          <Section id="news-set-sources" title={t('news.mutedSources', { n: prefs.muted.length })}
            right={prefs.muted.length > 0 && <button className={small} onClick={() => update({ muted: [] })}><RotateCcw size={11} /> {t('news.unmuteAll')}</button>}>
            <select value={srcCat} onChange={e => setSrcCat(e.target.value)} aria-label={t('news.rubric')}
              className="w-full bg-fc-input text-white rounded-lg px-2 py-1.5 text-sm">
              {allCats.map(c => <option key={c} value={c}>{groupOf(c) === 'youtube' ? `YouTube · ${short(c)}` : short(c)}</option>)}
            </select>
            <div className="space-y-0.5">
              {srcSites.map(s => {
                const off = prefs.muted.includes(s.id)
                return (
                  <div key={s.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-fc-hover/40 text-sm">
                    <Avatar name={s.name} size={20} />
                    <span className={`flex-1 truncate ${off ? 'text-fc-muted line-through' : 'text-fc-text'}`}>{s.name}</span>
                    <button onClick={() => togglePin(nav, `s:${s.id}`)} aria-pressed={pinned(`s:${s.id}`)} disabled={off}
                      aria-label={pinned(`s:${s.id}`) ? t('news.unpin') : t('news.pin')} className={`p-1 disabled:opacity-30 ${pinned(`s:${s.id}`) ? 'text-fc-accent' : 'text-fc-muted'} hover:text-white`}><Pin size={12} /></button>
                    <button role="switch" aria-checked={!off} aria-label={t('news.showSource', { name: s.name })}
                      onClick={() => update({ muted: off ? prefs.muted.filter(m => m !== s.id) : [...prefs.muted, s.id] })}
                      className={`relative w-9 h-5 rounded-full flex-shrink-0 transition-colors ${off ? 'bg-fc-hover' : 'bg-fc-accent'}`}>
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${off ? 'left-0.5' : 'left-[18px]'}`} />
                    </button>
                  </div>
                )
              })}
            </div>
          </Section>

          <Section id="news-set-groups" title={t('news.folding')}>
            <div className="flex gap-2 flex-wrap">
              <button className={small} onClick={() => foldAll(false)}>{t('news.unfoldAll')}</button>
              <button className={small} onClick={() => foldAll(true)}>{t('news.foldAll')}</button>
            </div>
          </Section>
        </div>
        <footer className="flex gap-2 p-3 border-t border-fc-hover flex-shrink-0">
          <button onClick={() => update({ theme: DEFAULT_THEME, pins: [], order: [], muted: [], folded: {} })} className="flex-1 py-2 rounded-lg bg-fc-hover text-sm text-fc-text hover:text-white">
            {t('news.resetAll')}
          </button>
          <button onClick={onClose} className="flex-1 py-2 rounded-lg bg-fc-accent text-sm font-medium text-white">{t('news.close')}</button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
