import { useState, useEffect } from 'react'

export function useCountdown(expiresAt: string | null): string | null {
  const [remaining, setRemaining] = useState<string | null>(null)

  useEffect(() => {
    if (!expiresAt) { setRemaining(null); return }

    const update = () => {
      const diff = new Date(expiresAt).getTime() - Date.now()
      if (diff <= 0) { setRemaining('Expiré'); return }
      const s = Math.ceil(diff / 1000)
      if (s < 60) setRemaining(`${s}s`)
      else if (s < 3600) setRemaining(`${Math.ceil(s / 60)}min`)
      else setRemaining(`${Math.ceil(s / 3600)}h`)
    }

    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [expiresAt])

  return remaining
}
