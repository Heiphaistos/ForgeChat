import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'

/**
 * Notification de mise à jour de l'application BUREAU (Tauri).
 *
 * Le web garde son propre mécanisme (`useUpdateNotifier` + /version.json) :
 * celui-ci ne s'affiche que dans l'application installée ou portable, et
 * s'appuie sur les commandes Rust de `desktop/src-tauri/src/updater.rs`.
 *
 * Aucune version n'apparaît ici : `current` et `version` viennent toutes deux
 * du back (binaire local vs manifeste serveur).
 */
export interface DesktopUpdateInfo {
  version: string
  current_version: string
  notes: string
  pub_date: string
  /** `windows-x86_64` | `windows-portable` | `linux-x86_64` | `linux-portable` */
  target: string
  /** true = l'exécutable est remplacé sur place, sans installeur ni UAC */
  portable: boolean
}

type Phase = 'idle' | 'downloading' | 'installing' | 'done' | 'error'

const EVT_PROGRESS = 'update://progress'

function formatDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function DesktopUpdateToast({ info, onClose }: { info: DesktopUpdateInfo; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [pct, setPct] = useState(0)
  const [error, setError] = useState('')
  const unlisten = useRef<null | (() => void)>(null)

  useEffect(() => () => { unlisten.current?.() }, [])

  const install = useCallback(async () => {
    setPhase('downloading')
    setPct(0)
    setError('')
    try {
      const [{ invoke }, { listen }] = await Promise.all([
        import('@tauri-apps/api/core'),
        import('@tauri-apps/api/event'),
      ])

      unlisten.current = await listen<{ downloaded: number; total: number }>(EVT_PROGRESS, e => {
        const { downloaded, total } = e.payload
        // total = 0 quand le serveur n'annonce pas Content-Length : on reste
        // sur une barre indéterminée plutôt que d'afficher un faux pourcentage.
        if (total > 0) setPct(Math.min(100, Math.round((downloaded / total) * 100)))
      })

      // Le Rust vérifie l'empreinte SHA-256 avant d'installer quoi que ce soit ;
      // une empreinte qui ne correspond pas remonte ici sous forme d'erreur.
      const needsRestart = await invoke<boolean>('update_install', { info })

      unlisten.current?.()
      unlisten.current = null

      if (needsRestart) {
        setPhase('done')
      } else {
        // Windows installé : le processus a déjà été remplacé par l'installeur
        // (on n'arrive ici que sur Linux .deb, remis à l'utilisateur).
        setPhase('installing')
      }
    } catch (e) {
      unlisten.current?.()
      unlisten.current = null
      setError(String(e))
      setPhase('error')
    }
  }, [info])

  const restart = useCallback(async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('update_restart')
  }, [])

  const date = formatDate(info.pub_date)

  return (
    <div className="w-[360px] max-w-[92vw] bg-fc-channel text-fc-text rounded-lg shadow-lg border border-fc-hover p-4 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold">
          Nouvelle version {info.version} disponible
        </div>
        {phase !== 'downloading' && (
          <button
            onClick={onClose}
            aria-label="Plus tard"
            title="Plus tard"
            className="text-fc-muted hover:text-fc-text leading-none px-1"
          >
            ✕
          </button>
        )}
      </div>

      <div className="text-xs text-fc-muted mt-0.5">
        Vous avez la {info.current_version}
        {date && ` · publiée le ${date}`}
        {info.portable && ' · version portable'}
      </div>

      {info.notes && phase === 'idle' && (
        <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap font-sans text-xs text-fc-text/90 bg-fc-bg rounded p-2">
          {info.notes}
        </pre>
      )}

      {phase === 'downloading' && (
        <div className="mt-3">
          <div className="text-xs text-fc-muted mb-1">
            Téléchargement et vérification… {pct > 0 && `${pct} %`}
          </div>
          <div
            className="h-1.5 w-full bg-fc-bg rounded overflow-hidden"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full bg-fc-accent transition-[width] duration-200"
              style={{ width: pct > 0 ? `${pct}%` : '33%' }}
            />
          </div>
        </div>
      )}

      {phase === 'installing' && (
        <div className="mt-3 text-xs text-fc-text/90">
          Paquet téléchargé et vérifié. Terminez l'installation dans la fenêtre qui vient de s'ouvrir,
          puis relancez ForgeChat.
        </div>
      )}

      {phase === 'error' && (
        <div className="mt-3 text-xs text-fc-red whitespace-pre-wrap">{error}</div>
      )}

      <div className="mt-3 flex justify-end gap-2">
        {(phase === 'idle' || phase === 'error') && (
          <button
            onClick={install}
            className="px-3 py-1.5 rounded bg-fc-accent text-white font-medium hover:brightness-110"
          >
            {phase === 'error' ? 'Réessayer' : 'Installer'}
          </button>
        )}
        {phase === 'done' && (
          <button
            onClick={restart}
            className="px-3 py-1.5 rounded bg-fc-green text-white font-medium hover:brightness-110"
          >
            Redémarrer maintenant
          </button>
        )}
      </div>
    </div>
  )
}

/** Affiche la notification, une seule à la fois. */
export function showDesktopUpdateToast(info: DesktopUpdateInfo) {
  toast.custom(
    t => <DesktopUpdateToast info={info} onClose={() => toast.dismiss(t.id)} />,
    { duration: Infinity, id: 'desktop-update' }
  )
}
