import { useEffect, useRef, useState } from 'react'
import { Hash, Volume2, Megaphone, Mic, MessagesSquare, Image as ImageIcon, ChevronDown, ChevronRight } from 'lucide-react'
import { useT } from '../../i18n'
import {
  type SyncTree, type TreeCategory, type ChannelKind, categoryState, toggleCategory, toggleChannel,
  selectAll, selectNone, invertSelection, counts, filterTree,
} from '../../lib/discordSyncTree'

// Arbre à cases à cocher « catégories > salons » de la synchro Discord (logique : lib/discordSyncTree.ts).

const ICONS: Record<ChannelKind, typeof Hash> = {
  text: Hash, voice: Volume2, announcement: Megaphone, stage: Mic, forum: MessagesSquare, media: ImageIcon,
}

function Check({ checked, mixed, label, onChange }: { checked: boolean; mixed?: boolean; label: string; onChange: (on: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!mixed }, [mixed])
  return (
    <input ref={ref} type="checkbox" checked={checked} aria-label={label}
      onChange={e => onChange(e.target.checked)} className="accent-fc-accent" />
  )
}

export default function DiscordSyncTree({ tree, sel, onChange }: { tree: SyncTree; sel: Set<string>; onChange: (s: Set<string>) => void }) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const shown = filterTree(tree, query)
  const { selected, total } = counts(tree, sel)
  const btn = 'px-2 py-1 bg-fc-hover hover:bg-fc-hover/70 text-white rounded text-xs'
  // Le filtre renvoie des catégories à salons réduits : les bascules partent toujours de l'arbre complet.
  const full = (cat: TreeCategory) => tree.categories.find(c => c.id === cat.id) ?? cat

  const row = (cat: TreeCategory | null, id: string, name: string, kind: ChannelKind, level: number) => {
    const Icon = ICONS[kind]
    return (
      <li key={id} role="treeitem" aria-level={level} aria-selected={sel.has(id)} className="py-0.5" style={{ paddingLeft: (level - 1) * 20 }}>
        <label className="flex items-center gap-2 text-sm text-white cursor-pointer min-w-0">
          <Check checked={sel.has(id)} label={name} onChange={on => onChange(toggleChannel(cat && full(cat), id, sel, on))} />
          <Icon size={14} className="text-fc-muted shrink-0" aria-hidden />
          <span className="truncate">{name}</span>
          <span className="text-xs text-fc-muted">{t(`dsync.kind.${kind}` as 'dsync.kind.text')}</span>
        </label>
      </li>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} maxLength={100}
          placeholder={t('dsync.treeSearch')} aria-label={t('dsync.treeSearch')}
          className="flex-1 min-w-[10rem] px-3 py-1.5 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm" />
        <button type="button" className={btn} onClick={() => onChange(selectAll(tree))}>{t('dsync.selectAll')}</button>
        <button type="button" className={btn} onClick={() => onChange(selectNone())}>{t('dsync.selectNone')}</button>
        <button type="button" className={btn} onClick={() => onChange(invertSelection(tree, sel))}>{t('dsync.invert')}</button>
      </div>
      <div className="text-xs text-fc-muted" role="status" aria-live="polite">{t('dsync.count', { n: selected, total })}</div>
      {shown.categories.length + shown.uncategorized.length === 0
        ? <p className="text-sm text-fc-muted">{t('dsync.treeEmpty')}</p>
        : (
          <ul role="tree" aria-label={t('dsync.treeLabel')} aria-multiselectable="true" className="max-h-80 overflow-y-auto pr-1">
            {shown.categories.map(cat => {
              const st = categoryState(full(cat), sel)
              const open = query !== '' || !closed.has(cat.id)
              return (
                <li key={cat.id} role="treeitem" aria-level={1} aria-expanded={open} aria-selected={st !== 'none'} className="py-0.5">
                  <div className="flex items-center gap-1">
                    <button type="button" aria-label={t(open ? 'dsync.collapse' : 'dsync.expand', { name: cat.name })}
                      onClick={() => setClosed(p => { const n = new Set(p); if (n.has(cat.id)) n.delete(cat.id); else n.add(cat.id); return n })}
                      className="text-fc-muted hover:text-white">
                      {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                    </button>
                    <label className="flex items-center gap-2 text-sm font-semibold text-white cursor-pointer min-w-0">
                      <Check checked={st === 'all'} mixed={st === 'some'} label={cat.name}
                        onChange={on => onChange(toggleCategory(full(cat), sel, on))} />
                      <span className="truncate">{cat.name}</span>
                      {cat.default_excluded && <span className="text-xs text-amber-300">({t('dsync.newsDetected')})</span>}
                    </label>
                  </div>
                  {open && <ul role="group">{cat.channels.map(ch => row(cat, ch.id, ch.name, ch.kind, 2))}</ul>}
                </li>
              )
            })}
            {shown.uncategorized.map(ch => row(null, ch.id, ch.name, ch.kind, 1))}
          </ul>
        )}
    </div>
  )
}
