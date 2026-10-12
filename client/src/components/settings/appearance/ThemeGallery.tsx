import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, Copy, Download, FileUp, Pencil, Plus, Search, Shuffle, Trash2, Wand2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useLang, useT, type Key } from '../../../i18n'
import {
  decodeTheme, hsl, MAX_CUSTOM_THEMES, newCustomId, PRESETS, PRESET_GROUPS, presetHue,
  type CustomTheme, type Preset, type PresetGroup, type ThemeSpec,
} from '../../../theme/themeCore'
import { resolveTheme, useThemeStore } from '../../../theme/themeStore'
import ThemePreview from './ThemePreview'
import { copyThemeCode, downloadTheme, readThemeFile } from './themeIO'

type Tab = PresetGroup | 'custom'
const TABS: Tab[] = [...PRESET_GROUPS, 'custom']
type SchemeFilter = 'any' | 'dark' | 'light'
/** 12 pastilles de couleur (secteurs de 30°) pour filtrer par teinte. */
const HUE_BUCKETS = Array.from({ length: 12 }, (_, i) => i * 30)
/** Vignettes affichées d'un coup (plus de 1 200 thèmes : affichage par pages). */
const PAGE = 48

const inBucket = (hue: number, bucket: number) => Math.abs(((((hue - bucket) % 360) + 540) % 360) - 180) <= 15
/** Recherche insensible à la casse et aux accents (« eme » trouve « Émeraude »). */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

const iconBtn = 'p-1.5 rounded-md text-fc-muted hover:text-white hover:bg-fc-hover transition'

function Card({ name, spec, active, onSelect, children }: {
  name: string; spec: ThemeSpec; active: boolean; onSelect: () => void; children?: ReactNode
}) {
  return (
    <div className={`relative rounded-lg overflow-hidden border-2 transition ${active ? 'border-fc-accent' : 'border-fc-hover hover:border-fc-muted'}`}>
      <button type="button" onClick={onSelect} aria-pressed={active} title={name} className="block w-full text-left">
        <ThemePreview spec={spec} />
        <div className="px-2 py-1 bg-fc-channel text-xs text-fc-text truncate">{name}</div>
      </button>
      {active && (
        <span className="absolute top-1 right-1 bg-fc-accent rounded-full p-0.5 pointer-events-none">
          <Check size={10} className="text-white" />
        </span>
      )}
      {children && <div className="flex justify-end gap-0.5 px-1 pb-1 bg-fc-channel">{children}</div>}
    </div>
  )
}

/**
 * Choix du thème : plus de 1 200 prédéfinis rangés en collections (recherche, filtres par couleur
 * et par luminosité, affichage par pages) et thèmes perso avec leurs actions.
 */
export default function ThemeGallery({ onEdit }: { onEdit: (t: CustomTheme) => void }) {
  const t = useT()
  const lang = useLang(s => s.lang)
  const { activeId, customs, select, upsertCustom, removeCustom } = useThemeStore()
  const [tab, setTab] = useState<Tab>(() => (customs.some(c => c.id === activeId) ? 'custom' : PRESETS.find(p => p.id === activeId)?.group ?? 'base'))
  const [importing, setImporting] = useState(false)
  const [code, setCode] = useState('')
  const [query, setQuery] = useState('')
  const [hue, setHue] = useState<number | null>(null)
  const [scheme, setScheme] = useState<SchemeFilter>('any')
  const [limit, setLimit] = useState(PAGE)
  const fileRef = useRef<HTMLInputElement>(null)

  const resetPage = () => setLimit(PAGE)
  const searching = query.trim().length > 0

  /** Préréglages affichés : la recherche porte sur toutes les collections, sinon sur l'onglet choisi. */
  const shown = useMemo<Preset[]>(() => {
    if (tab === 'custom' && !searching) return []
    const q = fold(query.trim())
    return PRESETS.filter(p => {
      if (!searching && p.group !== tab) return false
      if (searching && !fold(`${p.label.fr} ${p.label.en} ${p.id}`).includes(q)) return false
      if (hue !== null && !inBucket(presetHue(p), hue)) return false
      return scheme === 'any' || p.spec.scheme === scheme
    })
  }, [tab, query, searching, hue, scheme])

  const full = customs.length >= MAX_CUSTOM_THEMES
  const create = (spec: ThemeSpec, name: string) => {
    if (full) { toast.error(t('themes.tooMany', { n: MAX_CUSTOM_THEMES })); return null }
    return { ...spec, name: name.slice(0, 40), id: newCustomId() }
  }
  const customize = () => {
    const base = resolveTheme(useThemeStore.getState())
    const c = create(base, t('themes.copyOf', { name: base.name }))
    if (c) onEdit(c)
  }
  const duplicate = (src: CustomTheme) => {
    const c = create(src, t('themes.copyOf', { name: src.name }))
    if (c) { upsertCustom(c); toast.success(t('themes.duplicated')) }
  }
  const importSpec = (spec: ThemeSpec | null) => {
    if (!spec) { toast.error(t('themes.importInvalid')); return }
    const c = create(spec, spec.name)
    if (!c) return
    upsertCustom(c)
    select(c.id)
    setTab('custom')
    setImporting(false)
    setCode('')
    toast.success(t('themes.imported', { name: c.name }))
  }
  const copy = async (spec: ThemeSpec) => {
    if (await copyThemeCode(spec)) toast.success(t('themes.codeCopied'))
    else toast.error(t('themes.copyFailed'))
  }
  /** Au hasard parmi les thèmes affichés (tout le catalogue si rien n'est affiché). */
  const random = () => {
    const pool = shown.length ? shown : PRESETS
    const p = pool[Math.floor(Math.random() * pool.length)]
    if (!p) return
    select(p.id)
    toast.success(t('themes.randomDone', { name: p.label[lang] }))
  }

  const chip = (on: boolean) =>
    `px-2.5 h-7 rounded-full text-xs border transition ${on ? 'border-fc-accent bg-fc-accent/15 text-fc-text' : 'border-fc-hover text-fc-muted hover:text-white'}`
  const listed = tab !== 'custom' || searching

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" className="flex flex-wrap gap-1 bg-fc-channel rounded-lg p-1">
          {TABS.map(id => (
            <button key={id} role="tab" aria-selected={!searching && tab === id} onClick={() => { setTab(id); setQuery(''); resetPage() }}
              className={`px-3 py-1 rounded-md text-xs font-medium transition ${!searching && tab === id ? 'bg-fc-accent text-white' : 'text-fc-muted hover:text-white'}`}>
              {t(`themes.tab.${id}` as Key)}{id === 'custom' && customs.length ? ` (${customs.length})` : ''}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-1">
          <button onClick={random} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs border border-fc-hover text-fc-text hover:bg-fc-hover">
            <Shuffle size={13} /> {t('themes.random')}
          </button>
          <button onClick={customize} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-fc-accent text-white hover:opacity-90">
            <Wand2 size={13} /> {t('themes.customize')}
          </button>
          <button onClick={() => setImporting(v => !v)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs border border-fc-hover text-fc-text hover:bg-fc-hover">
            <FileUp size={13} /> {t('themes.import')}
          </button>
        </div>
      </div>

      {importing && (
        <div className="p-3 rounded-lg border border-fc-hover bg-fc-channel space-y-2">
          <p className="text-xs text-fc-muted">{t('themes.importHint')}</p>
          <textarea value={code} onChange={e => setCode(e.target.value)} rows={3} spellCheck={false}
            placeholder="FCTHEME1:…" aria-label={t('themes.importCode')}
            className="fc-input font-mono text-xs resize-y" />
          <div className="flex flex-wrap gap-2">
            <button onClick={() => importSpec(decodeTheme(code))} disabled={!code.trim()} className="btn-primary">{t('themes.importCode')}</button>
            <button onClick={() => fileRef.current?.click()} className="btn-secondary">{t('themes.importFile')}</button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden"
              onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importSpec(await readThemeFile(f)) }} />
          </div>
        </div>
      )}

      <div className="space-y-2">
        <label className="flex items-center gap-2 px-3 h-9 rounded-lg bg-fc-input text-sm">
          <Search size={14} className="text-fc-muted shrink-0" aria-hidden />
          <input value={query} onChange={e => { setQuery(e.target.value); resetPage() }} type="search"
            aria-label={t('themes.search')} placeholder={t('themes.searchPlaceholder', { n: PRESETS.length })}
            className="flex-1 min-w-0 bg-transparent outline-none text-fc-text placeholder:text-fc-muted" />
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          <div role="radiogroup" aria-label={t('themes.filterHue')} className="flex flex-wrap items-center gap-1.5">
            <button role="radio" aria-checked={hue === null} onClick={() => { setHue(null); resetPage() }} className={chip(hue === null)}>
              {t('themes.anyHue')}
            </button>
            {HUE_BUCKETS.map((h, i) => (
              <button key={h} role="radio" aria-checked={hue === h} onClick={() => { setHue(hue === h ? null : h); resetPage() }}
                aria-label={t('themes.hueLabel', { n: i + 1 })} title={t('themes.hueLabel', { n: i + 1 })}
                className={`w-6 h-6 rounded-full border-2 transition ${hue === h ? 'border-fc-text scale-110' : 'border-transparent'}`}
                style={{ background: hsl(h, 75, 55) }} />
            ))}
          </div>
          <span className="flex-1" />
          <div role="radiogroup" aria-label={t('themes.scheme')} className="flex gap-1">
            {(['any', 'dark', 'light'] as const).map(sc => (
              <button key={sc} role="radio" aria-checked={scheme === sc} onClick={() => { setScheme(sc); resetPage() }} className={chip(scheme === sc)}>
                {t(`themes.scheme.${sc}` as Key)}
              </button>
            ))}
          </div>
        </div>
        {listed && <p className="text-xs text-fc-muted" aria-live="polite">{t('themes.count', { n: shown.length })}</p>}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {shown.slice(0, limit).map(p => (
          <Card key={p.id} name={p.label[lang]} spec={p.spec} active={activeId === p.id} onSelect={() => select(p.id)} />
        ))}
        {!listed && customs.map(c => (
          <Card key={c.id} name={c.name} spec={c} active={activeId === c.id} onSelect={() => select(c.id)}>
            <button className={iconBtn} onClick={() => onEdit(c)} title={t('themes.edit')} aria-label={t('themes.edit')}><Pencil size={13} /></button>
            <button className={iconBtn} onClick={() => duplicate(c)} title={t('themes.duplicate')} aria-label={t('themes.duplicate')}><Plus size={13} /></button>
            <button className={iconBtn} onClick={() => copy(c)} title={t('themes.copyCode')} aria-label={t('themes.copyCode')}><Copy size={13} /></button>
            <button className={iconBtn} onClick={() => downloadTheme(c)} title={t('themes.download')} aria-label={t('themes.download')}><Download size={13} /></button>
            <button className={`${iconBtn} hover:text-fc-red`} title={t('themes.delete')} aria-label={t('themes.delete')}
              onClick={() => { if (window.confirm(t('themes.deleteConfirm', { name: c.name }))) removeCustom(c.id) }}>
              <Trash2 size={13} />
            </button>
          </Card>
        ))}
      </div>
      {shown.length > limit && (
        <button onClick={() => setLimit(l => l + PAGE * 2)} className="w-full py-2 rounded-lg text-sm border border-fc-hover text-fc-text hover:bg-fc-hover">
          {t('themes.showMore', { n: shown.length - limit })}
        </button>
      )}
      {listed && !shown.length && <p className="text-sm text-fc-muted">{t('themes.noMatch')}</p>}
      {!listed && !customs.length && <p className="text-sm text-fc-muted">{t('themes.noCustom')}</p>}
    </div>
  )
}
