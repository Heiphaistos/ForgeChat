// Activité « Joue à … » automatique, app de bureau seulement (comme Discord) : toutes les minutes,
// la commande Tauri `current_game` dit quel jeu tourne ; le profil est mis à jour quand il change.
// Une activité choisie à la main n'est jamais effacée : on ne retire que celle qu'on a posée.
import { useEffect } from 'react'
import api from '../api/client'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
export const AUTO_ACTIVITY_KEY = 'fc_auto_activity'
const autoOn = () => { try { return localStorage.getItem(AUTO_ACTIVITY_KEY) !== 'false' } catch { return true } }

export function useGameActivity(loggedIn: boolean) {
  useEffect(() => {
    if (!isTauri || !loggedIn) return
    let posted: string | null = null
    let stopped = false
    const tick = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        const game = autoOn() ? await invoke<string | null>('current_game') : null
        if (stopped || game === posted) return
        if (game) await api.patch('/users/me', { activity_type: 'playing', activity_name: game })
        else if (posted) await api.patch('/users/me', { activity_type: '' })
        posted = game
      } catch { /* app ancienne sans la commande, ou réseau : on réessaie plus tard */ }
    }
    void tick()
    const t = setInterval(tick, 60_000)
    return () => {
      stopped = true
      clearInterval(t)
    }
  }, [loggedIn])
}
