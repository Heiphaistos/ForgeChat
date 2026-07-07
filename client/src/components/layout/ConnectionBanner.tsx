import { useEffect, useState, useSyncExternalStore } from 'react'
import { WifiOff, RefreshCw } from 'lucide-react'
import { useWs } from '../../store/ws'

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

// Bannière globale d'état de connexion : n'apparaît qu'après 3s de
// déconnexion continue pour éviter le flash au chargement et lors des
// reconnexions instantanées du WS
export default function ConnectionBanner() {
  const wsConnected = useWs(s => s.connected)
  const browserOnline = useSyncExternalStore(subscribeOnline, () => navigator.onLine)
  const disconnected = !wsConnected || !browserOnline
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!disconnected) { setVisible(false); return }
    const t = setTimeout(() => setVisible(true), 3000)
    return () => clearTimeout(t)
  }, [disconnected])

  if (!visible || !disconnected) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed top-0 inset-x-0 z-[60] flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-medium text-white shadow-lg ${browserOnline ? 'bg-amber-600' : 'bg-red-600'}`}
    >
      {browserOnline ? (
        <>
          <RefreshCw size={13} className="animate-spin" aria-hidden />
          Reconnexion à ForgeChat...
        </>
      ) : (
        <>
          <WifiOff size={13} aria-hidden />
          Hors ligne — vérifiez votre connexion
        </>
      )}
    </div>
  )
}
