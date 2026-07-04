import { useEffect, useRef } from 'react'
import toast from 'react-hot-toast'

declare const __APP_VERSION__: string

const CHECK_INTERVAL = 5 * 60_000

/**
 * Détecte qu'une nouvelle version du client a été déployée (sonde
 * /version.json émis par le build) et affiche un toast persistant
 * proposant de recharger. Sondé toutes les 5 min + au retour de visibilité.
 */
export function useUpdateNotifier() {
  const notified = useRef(false)

  useEffect(() => {
    if (!import.meta.env.PROD) return

    const check = async () => {
      if (notified.current) return
      try {
        const res = await fetch('/version.json', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        if (data?.version && data.version !== __APP_VERSION__) {
          notified.current = true
          toast(
            (t) => (
              <span onClick={() => { toast.dismiss(t.id); window.location.reload() }} style={{ cursor: 'pointer' }}>
                Nouvelle version disponible — <b>cliquer pour recharger</b>
              </span>
            ),
            { duration: Infinity, icon: '🔄', id: 'app-update' }
          )
        }
      } catch { /* offline / réseau — on réessaiera */ }
    }

    const iv = setInterval(check, CHECK_INTERVAL)
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVisible) }
  }, [])
}
