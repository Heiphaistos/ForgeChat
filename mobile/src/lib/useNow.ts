import { useEffect, useState } from 'react'

/** Horloge réactive (durées d'appel…) — évite d'appeler Date.now() pendant le rendu. */
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs, enabled])
  return now
}
