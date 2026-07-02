import { useEffect, useLayoutEffect, useRef, useState } from 'react'

interface ReactionUser {
  user_id: string
  username: string
  avatar?: string
}

interface Props {
  emoji: string
  users: ReactionUser[]
  onClose: () => void
  x: number
  y: number
}

export default function ReactionPopup({ emoji, users, onClose, x, y }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<React.CSSProperties>({
    position: 'fixed',
    left: x,
    top: y,
    zIndex: 200,
    transform: 'translateY(-100%)',
    visibility: 'hidden',
  })

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  // Clamp popup within viewport after first paint
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const margin = 8
    let left = x
    let top = y - height

    // Flip below cursor if would clip top edge
    if (top < margin) top = y + margin

    // Clamp right edge
    if (left + width > window.innerWidth - margin) left = window.innerWidth - width - margin

    // Clamp left edge
    if (left < margin) left = margin

    setStyle({ position: 'fixed', left, top, zIndex: 200, visibility: 'visible' })
  }, [x, y])

  return (
    <div ref={ref} style={style} className="bg-fc-channel border border-fc-hover rounded-lg shadow-xl p-3 min-w-[160px] max-w-[220px]">
      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-fc-hover">
        <span className="text-xl">{emoji}</span>
        <span className="text-xs text-fc-muted">{users.length} réaction{users.length > 1 ? 's' : ''}</span>
      </div>
      <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto">
        {users.map(u => (
          <div key={u.user_id} className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-fc-accent flex items-center justify-center text-xs font-bold text-white flex-shrink-0 overflow-hidden">
              {u.avatar
                ? <img src={u.avatar} alt="" className="w-full h-full object-cover" />
                : u.username.charAt(0).toUpperCase()}
            </div>
            <span className="text-xs text-fc-text truncate">{u.username}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
