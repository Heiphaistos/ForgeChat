import { useCallback, useSyncExternalStore } from 'react'

/** Media query suivie en direct (rotation, redimensionnement), pas lue une seule fois au montage. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const m = window.matchMedia(query)
    m.addEventListener('change', onChange)
    return () => m.removeEventListener('change', onChange)
  }, [query])
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches)
}
