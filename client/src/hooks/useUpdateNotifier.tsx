import { useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { showDesktopUpdateToast, type DesktopUpdateInfo } from '../components/DesktopUpdateToast'

declare const __APP_VERSION__: string

const CHECK_INTERVAL = 5 * 60_000
/** L'application bureau se met à jour par téléchargement : inutile de sonder souvent. */
const DESKTOP_CHECK_INTERVAL = 6 * 60 * 60_000

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/**
 * Application BUREAU : interroge le manifeste servi par
 * `GET /api/desktop/latest` via la commande Rust `update_check`, qui choisit
 * seule la cible (installée ou portable) et compare les versions.
 *
 * Un canal injoignable n'affiche rien : l'utilisateur continue de travailler
 * avec la version qu'il a.
 */
function useDesktopUpdateNotifier() {
  const notified = useRef(false)

  useEffect(() => {
    // En dev le binaire lancé est celui de `tauri dev` : il n'a pas
    // d'uninstall.exe à côté, donc le chemin portable le remplacerait par une
    // build de production. On ne vérifie rien tant qu'on développe.
    if (!isTauri || import.meta.env.DEV) return

    let cancelled = false
    const check = async () => {
      if (cancelled || notified.current) return
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        const info = await invoke<DesktopUpdateInfo | null>('update_check')
        if (cancelled || !info) return
        notified.current = true
        showDesktopUpdateToast(info)
      } catch (e) {
        console.warn('[maj] vérification de mise à jour impossible', e)
      }
    }

    check()
    const iv = setInterval(check, DESKTOP_CHECK_INTERVAL)
    return () => { cancelled = true; clearInterval(iv) }
  }, [])
}

/**
 * Détecte qu'une nouvelle version du client a été déployée (sonde
 * /version.json émis par le build) et affiche un toast persistant
 * proposant de recharger. Sondé toutes les 5 min + au retour de visibilité.
 *
 * Web/PWA uniquement — dans l'application bureau le front est empaqueté avec
 * le binaire, /version.json y est toujours celui du bundle local : c'est
 * `useDesktopUpdateNotifier` qui prend le relais.
 */
export function useUpdateNotifier() {
  const notified = useRef(false)

  useDesktopUpdateNotifier()

  useEffect(() => {
    if (!import.meta.env.PROD || isTauri) return

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
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span onClick={() => { toast.dismiss(t.id); window.location.reload() }} style={{ cursor: 'pointer' }}>
                  Nouvelle version disponible — <b>cliquer pour recharger</b>
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); toast.dismiss(t.id) }}
                  aria-label="Plus tard"
                  title="Plus tard"
                  style={{ background: 'none', border: 'none', color: '#72767d', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 4 }}
                >
                  ✕
                </button>
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
