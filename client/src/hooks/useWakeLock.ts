import { useEffect, useRef } from 'react'

type WakeLockSentinel = { release: () => Promise<void>; released: boolean }

/**
 * Garde l'écran allumé tant que `active` est vrai (appel vocal en cours).
 * Le wake lock est automatiquement libéré par l'OS quand l'onglet passe en
 * arrière-plan — on le ré-acquiert au retour de visibilité.
 * No-op silencieux sur les navigateurs sans Wake Lock API.
 */
export function useWakeLock(active: boolean) {
  const sentinel = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> } }
    if (!active || !nav.wakeLock) return

    let cancelled = false
    const acquire = async () => {
      try {
        const lock = await nav.wakeLock!.request('screen')
        if (cancelled) { lock.release().catch(() => {}) } else { sentinel.current = lock }
      } catch { /* refusé (batterie faible, permission) — tant pis */ }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && (!sentinel.current || sentinel.current.released)) {
        acquire()
      }
    }

    acquire()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      sentinel.current?.release().catch(() => {})
      sentinel.current = null
    }
  }, [active])
}
