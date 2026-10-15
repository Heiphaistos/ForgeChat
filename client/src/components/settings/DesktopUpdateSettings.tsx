import { useState } from 'react'
import toast from 'react-hot-toast'
import { Toggle } from './shared'
import {
  autoUpdateEnabled, setAutoUpdateEnabled, showDesktopUpdateToast, type DesktopUpdateInfo,
} from '../DesktopUpdateToast'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** Mises à jour de l'application bureau : bouton manuel + réglage de la vérification automatique. */
export default function DesktopUpdateSettings() {
  const [auto, setAuto] = useState(autoUpdateEnabled)
  const [busy, setBusy] = useState(false)

  if (!isTauri) return null

  async function check() {
    if (import.meta.env.DEV) { toast('Indisponible en mode développement'); return }
    setBusy(true)
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const info = await invoke<DesktopUpdateInfo | null>('update_check')
      if (info) showDesktopUpdateToast(info)
      else toast.success('ForgeChat est à jour')
    } catch (e) {
      toast.error(`Vérification impossible : ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-white mb-2">Mises à jour</h3>
      <p className="text-xs text-fc-muted mb-3">
        Chaque mise à jour est vérifiée (signature et empreinte) avant d'être installée.
      </p>
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="text-sm text-white">Vérifier les mises à jour automatiquement</span>
        <Toggle value={auto} onChange={v => { setAuto(v); setAutoUpdateEnabled(v) }} />
      </div>
      <button
        onClick={check}
        disabled={busy}
        className="px-4 py-2 bg-fc-hover text-white rounded-lg text-sm hover:bg-fc-hover/80 transition disabled:opacity-50"
      >
        {busy ? 'Recherche…' : 'Rechercher une mise à jour'}
      </button>
    </div>
  )
}
