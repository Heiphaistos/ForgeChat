import { useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../api/client'
import { matches, resolveBindings } from '../lib/shortcuts'
import { useUnread } from '../store/unread'
import { useVoice } from '../store/voice'
import { useAppLock } from '../lib/appLock'
import { t as tr, type Key } from '../i18n'

/** Libellé traduit d'une action de raccourci. */
export const shortcutLabel = (action: string): Key => `keys.action.${action}` as Key

/** Raccourcis effectifs (défauts + personnalisés), partagés par les réglages, le vocal et l'appli. */
export function useShortcutBindings(): Record<string, string> {
  const { data } = useQuery<{ action: string; key_combo: string }[]>({
    queryKey: ['keybindings'],
    queryFn: () => api.get('/user/keybindings').then(r => r.data),
    staleTime: 300_000,
  })
  return useMemo(() => resolveBindings(data), [data])
}

/** Déclenche une action de raccourci (palette de commandes, menus). */
export const runShortcut = (action: string) =>
  window.dispatchEvent(new CustomEvent('forgechat:shortcut', { detail: action }))

interface Handlers {
  togglePalette: () => void
  toggleQuickSwitcher: () => void
  toggleHelp: () => void
  closeAll: () => void
}

const isEditable = (el: EventTarget | null) => {
  const n = el as HTMLElement | null
  return n?.tagName === 'INPUT' || n?.tagName === 'TEXTAREA' || n?.isContentEditable === true
}

// Raccourcis du vocal traités par VoiceHotkeys quand on est en vocal.
const VOICE_ONLY = new Set(['push_to_talk', 'toggle_screen_share', 'toggle_camera', 'clip_stream'])

/** Raccourcis globaux de l'appli, selon les réglages de l'utilisateur. */
export function useGlobalShortcuts(h: Handlers) {
  const bindings = useShortcutBindings()
  const nav = useNavigate()
  const qc = useQueryClient()
  const handlers = useRef(h)
  handlers.current = h

  useEffect(() => {
    const path = () => window.location.pathname
    const cycleServer = (dir: 1 | -1) => {
      const servers = qc.getQueryData<{ id: string }[]>(['servers']) ?? []
      if (servers.length === 0) return
      const idx = servers.findIndex(s => s.id === path().match(/\/servers\/([^/]+)/)?.[1])
      nav(`/servers/${servers[(idx + dir + servers.length) % servers.length].id}`)
    }
    const cycleUnread = (dir: 1 | -1) => {
      const m = path().match(/\/servers\/([^/]+)(?:\/channels\/([^/]+))?/)
      if (!m) return
      const chs = (qc.getQueryData<{ channels: any[] }>(['server', m[1]])?.channels ?? [])
        .filter((c: any) => !c.archived && !c.hidden && (c.type === 'text' || c.type === 'announcement'))
      if (chs.length === 0) return
      const unread = chs.filter((c: any) => (useUnread.getState().counts[c.id] ?? 0) > 0)
      const list = unread.length > 0 ? unread : chs
      const idx = list.findIndex((c: any) => c.id === (m[2] ?? ''))
      nav(`/servers/${m[1]}/channels/${list[(idx + dir + list.length) % list.length].id}`)
    }

    // Renvoie false si l'action ne s'applique pas ici (le navigateur garde la touche).
    const run = (action: string): boolean => {
      const x = handlers.current
      switch (action) {
        case 'search': x.togglePalette(); return true
        case 'quick_switcher': x.toggleQuickSwitcher(); return true
        case 'shortcuts_help': x.toggleHelp(); return true
        case 'open_settings': nav('/settings'); return true
        case 'next_unread': cycleUnread(1); return true
        case 'prev_unread': cycleUnread(-1); return true
        case 'next_server': cycleServer(1); return true
        case 'prev_server': cycleServer(-1); return true
        case 'lock_app': window.dispatchEvent(new Event('forgechat:lock-now')); return true
        case 'toggle_split': window.dispatchEvent(new CustomEvent('forgechat:toggle-split')); return true
        case 'toggle_mute': useVoice.getState().toggleMute(); return true
        case 'toggle_deafen': useVoice.getState().toggleDeafen(); return true
        case 'mark_all_read':
          useUnread.getState().markAllRead()
          qc.invalidateQueries({ queryKey: ['user_mentions'] })
          toast.success(tr('toast.allRead'))
          return true
        case 'search_channel':
          if (!/\/servers\/[^/]+\/channels\/[^/]+|\/dm\//.test(path())) return false
          window.dispatchEvent(new CustomEvent('forgechat:toggle-search'))
          return true
        default: return false
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if (useAppLock.getState().locked) return
      if (e.key === 'Escape') { handlers.current.closeAll(); return }
      const editable = isEditable(e.target)
      // « ? » hors saisie : aide (fixe, en plus du raccourci réglable).
      if (e.key === '?' && !editable && !e.ctrlKey && !e.metaKey && !e.altKey) { handlers.current.toggleHelp(); return }
      const joined = useVoice.getState().joined
      for (const [action, combo] of Object.entries(bindings)) {
        if (VOICE_ONLY.has(action)) continue
        // En vocal, VoiceHotkeys gère micro et casque (hors champs de saisie).
        if (joined && (action === 'toggle_mute' || action === 'toggle_deafen')) continue
        if (!matches(e, combo)) continue
        // Flèches de navigation : laissées au champ de saisie (déplacement du curseur).
        if (editable && (action.endsWith('_unread') || action.endsWith('_server'))) return
        if (run(action)) e.preventDefault()
        return
      }
    }
    const onAction = (e: Event) => { run(String((e as CustomEvent).detail)) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('forgechat:shortcut', onAction)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('forgechat:shortcut', onAction)
    }
  }, [bindings, nav, qc])
}
