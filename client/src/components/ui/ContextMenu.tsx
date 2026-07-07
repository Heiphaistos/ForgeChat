import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface ContextMenuItem {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  separator?: false
}
export interface ContextMenuSeparator { separator: true }
export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuEntry[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  useEffect(() => {
    if (ref.current) {
      const w = ref.current.offsetWidth || 200
      const h = ref.current.offsetHeight || 40 * items.length
      setPos({
        x: Math.max(8, Math.min(x, window.innerWidth - w - 8)),
        y: Math.max(8, Math.min(y, window.innerHeight - h - 8)),
      })
    }
  }, [x, y])

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
    <>
      {isSheet && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 99998 }}
          className="bg-black/50"
          aria-hidden
          onMouseDown={onClose}
        />
      )}
      <div
      ref={ref}
      role="menu"
      style={isSheet
        ? { position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 99999, maxHeight: '70dvh' }
        : { position: 'fixed', top: pos.y, left: pos.x, zIndex: 99999 }}
      className={isSheet
        ? 'bg-fc-bg border-t border-fc-hover rounded-t-2xl shadow-2xl pt-1 pb-[max(env(safe-area-inset-bottom),0.5rem)] select-none overflow-y-auto overscroll-contain sheet-slide-up'
        : 'min-w-[180px] bg-fc-bg border border-fc-hover rounded-lg shadow-2xl py-1 select-none'}
      onMouseDown={e => e.stopPropagation()}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation() }}
    >
      {isSheet && <div className="mx-auto mt-1 mb-1.5 w-10 h-1 rounded-full bg-fc-hover" aria-hidden />}
      {items.map((item, i) => {
        if ('separator' in item && item.separator) {
          return <div key={i} role="separator" className="my-1 border-t border-fc-hover" />
        }
        const it = item as ContextMenuItem
        return (
          <button
            key={i}
            role="menuitem"
            disabled={it.disabled}
            aria-disabled={it.disabled}
            onClick={() => { it.onClick(); onClose() }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 min-h-[44px] text-sm transition text-left
              ${it.danger
                ? 'text-fc-red hover:bg-fc-red/10'
                : 'text-fc-text hover:bg-fc-hover hover:text-white'}
              ${it.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            {it.icon && <span className="flex-shrink-0 opacity-70" aria-hidden>{it.icon}</span>}
            {it.label}
          </button>
        )
      })}
    </div>
    </>,
    document.body
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
