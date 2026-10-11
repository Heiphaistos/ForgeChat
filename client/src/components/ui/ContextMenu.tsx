import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { useT } from '../../i18n'

export interface ContextMenuItem {
  label: string
  icon?: ReactNode
  /** Facultatif pour une entrée qui n'ouvre qu'un sous-menu. */
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
  /** Sous-ligne grisée (ex. « Seulement visible par toi »). */
  hint?: string
  /** Case à cocher affichée à droite ; `undefined` = entrée simple. */
  checked?: boolean
  /** Sous-menu : survol ou clic sur ordinateur, navigation dans la feuille sur mobile. */
  submenu?: ContextMenuEntry[]
  separator?: false
  header?: undefined
}
export interface ContextMenuSeparator { separator: true }
/** En-tête grisé non cliquable. */
export interface ContextMenuHeader { header: string; separator?: false }
/** Contenu libre dans le menu (ex. curseur de volume) : les clics y restent, le menu reste ouvert. */
export interface ContextMenuCustom { custom: ReactNode; separator?: false }
export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator | ContextMenuHeader | ContextMenuCustom

const isSeparator = (e: ContextMenuEntry): e is ContextMenuSeparator => 'separator' in e && e.separator === true
const isHeader = (e: ContextMenuEntry): e is ContextMenuHeader => 'header' in e && typeof e.header === 'string'
const isCustom = (e: ContextMenuEntry): e is ContextMenuCustom => 'custom' in e
const isItem = (e: ContextMenuEntry): e is ContextMenuItem => !isSeparator(e) && !isHeader(e) && !isCustom(e)

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuEntry[]
  onClose: () => void
}

function Rows({ items, sheet, onClose, onOpenSub, openSub }: {
  items: ContextMenuEntry[]
  sheet: boolean
  onClose: () => void
  onOpenSub: (i: number, anchor: DOMRect | null) => void
  openSub: number | null
}) {
  return (
    <>
      {items.map((item, i) => {
        if (isSeparator(item)) return <div key={i} role="separator" className="my-1 border-t border-fc-hover" />
        if (isHeader(item)) {
          return <div key={i} role="presentation" className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-fc-muted truncate">{item.header}</div>
        }
        if (isCustom(item)) {
          return <div key={i} role="none" className="px-3 py-2" onMouseEnter={sheet ? undefined : () => onOpenSub(-1, null)}>{item.custom}</div>
        }
        const hasSub = !!item.submenu?.length
        const activate = (el: HTMLElement) => {
          if (item.disabled) return
          if (hasSub) { onOpenSub(i, el.getBoundingClientRect()); return }
          item.onClick?.()
          onClose()
        }
        return (
          <button
            key={i}
            role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={item.checked}
            aria-haspopup={hasSub || undefined}
            aria-expanded={hasSub ? openSub === i : undefined}
            disabled={item.disabled}
            aria-disabled={item.disabled}
            onClick={e => activate(e.currentTarget)}
            onMouseEnter={sheet ? undefined : e => onOpenSub(hasSub && !item.disabled ? i : -1, e.currentTarget.getBoundingClientRect())}
            className={`w-full flex items-center gap-2.5 px-3 py-2 min-h-[44px] md:min-h-[36px] text-sm transition text-left
              ${item.danger
                ? 'text-fc-red hover:bg-fc-red/10'
                : `text-fc-text hover:bg-fc-hover hover:text-white ${openSub === i ? 'bg-fc-hover text-white' : ''}`}
              ${item.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            {item.icon && <span className="flex-shrink-0 opacity-70" aria-hidden>{item.icon}</span>}
            <span className="flex-1 min-w-0">
              <span className="block truncate">{item.label}</span>
              {item.hint && <span className="block text-[11px] text-fc-muted truncate">{item.hint}</span>}
            </span>
            {item.checked !== undefined && (
              <span aria-hidden className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center ${item.checked ? `${item.danger ? 'bg-fc-red border-fc-red' : 'bg-fc-accent border-fc-accent'} text-white` : item.danger ? 'border-fc-red' : 'border-fc-muted'}`}>
                {item.checked && <Check size={12} />}
              </span>
            )}
            {hasSub && <ChevronRight size={14} className="flex-shrink-0 opacity-60" aria-hidden />}
          </button>
        )
      })}
    </>
  )
}

/** Panneau positionné au pointeur (racine) ou à côté de l'entrée parente (sous-menu). */
function Panel({ x, y, anchor, items, onClose, onHover }: {
  x: number; y: number; anchor?: DOMRect; items: ContextMenuEntry[]; onClose: () => void
  /** Survol d'un sous-menu : garde ouvert le parent. */
  onHover?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [sub, setSub] = useState<{ i: number; anchor: DOMRect } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth || 200
    const h = el.offsetHeight || 40 * items.length
    // Sous-menu : à droite de l'entrée, sinon à sa gauche s'il n'y a pas la place.
    const nx = anchor && x + w > window.innerWidth - 8 ? anchor.left - w : x
    setPos({
      x: Math.max(8, Math.min(nx, window.innerWidth - w - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - h - 8)),
    })
  }, [x, y, anchor, items.length])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  // Petit délai à la fermeture : la diagonale vers le sous-menu ne le referme pas.
  const openSub = (i: number, a: DOMRect | null) => {
    if (timer.current) clearTimeout(timer.current)
    if (i >= 0 && a) setSub({ i, anchor: a })
    else timer.current = setTimeout(() => setSub(null), 200)
  }
  const child = sub ? items[sub.i] : null
  const childItems = child && isItem(child) ? child.submenu : undefined

  return (
    <>
      <div
        ref={ref}
        role="menu"
        style={{ position: 'fixed', top: pos.y, left: pos.x, zIndex: 99999 }}
        className="min-w-[200px] max-w-[300px] max-h-[calc(100dvh-16px)] overflow-y-auto bg-fc-bg border border-fc-hover rounded-lg shadow-2xl py-1 select-none"
        onMouseDown={e => e.stopPropagation()}
        onMouseEnter={() => { if (timer.current) clearTimeout(timer.current); onHover?.() }}
        onContextMenu={e => { e.preventDefault(); e.stopPropagation() }}
      >
        <Rows items={items} sheet={false} onClose={onClose} onOpenSub={openSub} openSub={sub?.i ?? null} />
      </div>
      {sub && childItems && (
        <Panel key={sub.i} x={sub.anchor.right} y={sub.anchor.top - 4} anchor={sub.anchor} items={childItems} onClose={onClose}
          onHover={() => { if (timer.current) clearTimeout(timer.current) }} />
      )}
    </>
  )
}

/** Feuille du bas (mobile) : un sous-menu remplace la liste, avec un retour. */
function Sheet({ items, onClose }: { items: ContextMenuEntry[]; onClose: () => void }) {
  const t = useT()
  const [stack, setStack] = useState<{ title: string; items: ContextMenuEntry[] }[]>([])
  const current = stack.length ? stack[stack.length - 1] : null
  const list = current?.items ?? items
  const openSub = (i: number) => {
    const it = list[i]
    if (it && isItem(it) && it.submenu) {
      const sub = it.submenu
      setStack(s => [...s, { title: it.label, items: sub }])
    }
  }
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 99998 }} className="bg-black/50" aria-hidden onMouseDown={onClose} />
      <div
        role="menu"
        style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 99999, maxHeight: '70dvh' }}
        className="bg-fc-bg border-t border-fc-hover rounded-t-2xl shadow-2xl pt-1 pb-[max(env(safe-area-inset-bottom),0.5rem)] select-none overflow-y-auto overscroll-contain sheet-slide-up"
        onMouseDown={e => e.stopPropagation()}
        onContextMenu={e => { e.preventDefault(); e.stopPropagation() }}
      >
        <div className="mx-auto mt-1 mb-1.5 w-10 h-1 rounded-full bg-fc-hover" aria-hidden />
        {current && (
          <button onClick={() => setStack(s => s.slice(0, -1))}
            className="w-full flex items-center gap-2 px-3 py-2 min-h-[44px] text-sm text-fc-muted hover:text-white border-b border-fc-hover">
            <ChevronLeft size={16} aria-hidden /> <span className="truncate">{t('common.back')} · {current.title}</span>
          </button>
        )}
        <Rows key={stack.length} items={list} sheet onClose={onClose} onOpenSub={openSub} openSub={null} />
      </div>
    </>
  )
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  useEffect(() => {
    const handler = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      onClose()
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('contextmenu', handler)
    document.addEventListener('keydown', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('contextmenu', handler)
      document.removeEventListener('keydown', handler)
    }
  }, [onClose])

  // Bottom-sheet sur mobile (cohérent avec le menu des messages),
  // menu positionné au pointeur sur desktop
  const isSheet = window.innerWidth < 768
  return createPortal(
    isSheet ? <Sheet items={items} onClose={onClose} /> : <Panel x={x} y={y} items={items} onClose={onClose} />,
    document.body,
  )
}

export function useContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null)

  const open = (e: React.MouseEvent, items: ContextMenuEntry[]) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  const openAt = (x: number, y: number, items: ContextMenuEntry[]) => {
    setMenu({ x, y, items })
  }

  const close = () => setMenu(null)

  const node = menu ? (
    <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={close} />
  ) : null

  return { open, openAt, close, node }
}

// Un seul appui long à la fois : minuteur partagé, que la ligne se re-rende ou non pendant l'appui.
let pressTimer: ReturnType<typeof setTimeout> | null = null
const cancelPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null } }

/** Appui long (500 ms) sur écran tactile : ouvre un menu au point touché. */
export function longPress(open: (x: number, y: number) => void) {
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const { clientX, clientY } = e.touches[0]
      cancelPress()
      pressTimer = setTimeout(() => {
        pressTimer = null
        if ('vibrate' in navigator) navigator.vibrate(20)
        open(clientX, clientY)
      }, 500)
    },
    onTouchEnd: cancelPress,
    onTouchCancel: cancelPress,
    onTouchMove: cancelPress,
  }
}
