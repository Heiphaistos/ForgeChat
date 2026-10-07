import { useRef, useState, type ReactNode } from 'react'
import { Check, Copy, Download, FileUp, Pencil, Plus, Trash2, Wand2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useLang, useT, type Key } from '../../../i18n'
import { decodeTheme, MAX_CUSTOM_THEMES, newCustomId, PRESETS, type CustomTheme, type PresetGroup, type ThemeSpec } from '../../../theme/themeCore'
import { resolveTheme, useThemeStore } from '../../../theme/themeStore'
import ThemePreview from './ThemePreview'
import { copyThemeCode, downloadTheme, readThemeFile } from './themeIO'

type Tab = PresetGroup | 'custom'
const TABS: { id: Tab; label: Key }[] = [
  { id: 'base', label: 'themes.tab.base' },
  { id: 'gradient', label: 'themes.tab.gradient' },
  { id: 'classic', label: 'themes.tab.classic' },
  { id: 'custom', label: 'themes.tab.custom' },
]

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

/** Choix du thème : prédéfinis (base, dégradés, classiques) et thèmes perso avec leurs actions. */
export default function ThemeGallery({ onEdit }: { onEdit: (t: CustomTheme) => void }) {
  const t = useT()
  const lang = useLang(s => s.lang)
  const { activeId, customs, select, upsertCustom, removeCustom } = useThemeStore()
  const [tab, setTab] = useState<Tab>(() => (customs.some(c => c.id === activeId) ? 'custom' : PRESETS.find(p => p.id === activeId)?.group ?? 'base'))
  const [importing, setImporting] = useState(false)
  const [code, setCode] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" className="flex flex-wrap gap-1 bg-fc-channel rounded-lg p-1">
          {TABS.map(x => (
            <button key={x.id} role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition ${tab === x.id ? 'bg-fc-accent text-white' : 'text-fc-muted hover:text-white'}`}>
              {t(x.label)}{x.id === 'custom' && customs.length ? ` (${customs.length})` : ''}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-1">
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

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {tab !== 'custom' && PRESETS.filter(p => p.group === tab).map(p => (
          <Card key={p.id} name={p.label[lang]} spec={p.spec} active={activeId === p.id} onSelect={() => select(p.id)} />
        ))}
        {tab === 'custom' && customs.map(c => (
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
      {tab === 'custom' && !customs.length && <p className="text-sm text-fc-muted">{t('themes.noCustom')}</p>}
    </div>
  )
}
