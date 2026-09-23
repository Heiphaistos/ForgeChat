import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../../api/client'
import { useVoice } from '../../store/voice'

/**
 * Raccourcis vocaux, montés au niveau racine.
 *
 * Avant : les écouteurs vivaient dans VoiceVideoPage (donc morts dès qu'on
 * quittait la page d'appel), la touche de push-to-talk était codée en dur (P ou
 * Espace) et les raccourcis configurés dans les Réglages n'étaient lus par
 * personne — le réglage « Push-to-Talk » et le raccourci « Partager l'écran »
 * étaient de pures décorations.
 *
 * Sur le bureau (Tauri), le push-to-talk est aussi enregistré comme raccourci
 * GLOBAL : sans ça il ne répond pas quand ForgeChat n'a pas le focus, c'est-à-dire
 * exactement pendant une partie en plein écran.
 */

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const DEFAULTS: Record<string, string> = {
  toggle_mute: 'Ctrl+M',
  toggle_deafen: 'Ctrl+D',
  // Un modificateur seul ne peut pas être enregistré comme raccourci global
  // (limite de l'API OS) : le défaut est un vrai combo.
  push_to_talk: 'Ctrl+Shift+Space',
  toggle_screen_share: 'Ctrl+Alt+S',
  toggle_camera: 'Ctrl+Shift+C',
}

function normalize(binding: string): { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; key: string } {
  const parts = binding.split('+').map(p => p.trim()).filter(Boolean)
  const mods = { ctrl: false, alt: false, shift: false, meta: false }
  let key = ''
  for (const p of parts) {
    const low = p.toLowerCase()
    if (low === 'ctrl' || low === 'control') mods.ctrl = true
    else if (low === 'alt') mods.alt = true
    else if (low === 'shift') mods.shift = true
    else if (low === 'meta' || low === 'cmd' || low === 'super') mods.meta = true
    else key = p
  }
  return { ...mods, key: key.toLowerCase() }
}

function matches(e: KeyboardEvent, binding: string): boolean {
  const b = normalize(binding)
  if (e.ctrlKey !== b.ctrl || e.altKey !== b.alt || e.shiftKey !== b.shift || e.metaKey !== b.meta) return false
  if (!b.key) return false
  const k = e.key.toLowerCase()
  return k === b.key || (b.key === 'space' && k === ' ')
}

/** Convertit un raccourci ForgeChat en accélérateur global Tauri (KeyboardEvent.code). */
function toAccelerator(binding: string): string {
  const b = normalize(binding)
  const parts: string[] = []
  if (b.ctrl) parts.push('Control')
  if (b.alt) parts.push('Alt')
  if (b.shift) parts.push('Shift')
  if (b.meta) parts.push('Super')
  if (!b.key) return ''
  if (b.key === 'space' || b.key === ' ') parts.push('Space')
  else if (b.key.length === 1) parts.push(`Key${b.key.toUpperCase()}`)
  else parts.push(b.key.charAt(0).toUpperCase() + b.key.slice(1))
  return parts.join('+')
}

function isEditable(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null
  const tag = node?.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || node?.isContentEditable === true
}

export default function VoiceHotkeys() {
  const joined = useVoice(s => s.joined)
  const pttMode = useVoice(s => s.pttMode)
  const screenSharing = useVoice(s => s.screenSharing)
  const pttHeld = useRef(false)

  const { data: custom = {} } = useQuery<Record<string, string>>({
    queryKey: ['keybindings'],
    queryFn: () => api.get('/user/keybindings').then(r => r.data),
    staleTime: 300_000,
  })

  const binding = (action: string) => (custom as any)?.[action] || DEFAULTS[action]

  // ── Raccourcis fenêtre ──────────────────────────────────────────────────
  useEffect(() => {
    if (!joined) return
    const v = useVoice.getState()

    const onDown = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return
      if (pttMode && matches(e, binding('push_to_talk'))) {
        e.preventDefault()
        if (!pttHeld.current) { pttHeld.current = true; v.activatePtt() }
        return
      }
      if (matches(e, binding('toggle_mute'))) { e.preventDefault(); useVoice.getState().toggleMute(); return }
      if (matches(e, binding('toggle_deafen'))) { e.preventDefault(); useVoice.getState().toggleDeafen(); return }
      if (matches(e, binding('toggle_camera'))) { e.preventDefault(); void useVoice.getState().toggleVideo(); return }
      if (matches(e, binding('toggle_screen_share'))) {
        e.preventDefault()
        const st = useVoice.getState()
        if (st.screenSharing) void st.stopScreenShare()
        else void st.shareScreen()
      }
    }

    const onUp = (e: KeyboardEvent) => {
      if (!pttMode || !pttHeld.current) return
      const b = normalize(binding('push_to_talk'))
      const k = e.key.toLowerCase()
      const released = k === b.key || (b.key === 'space' && k === ' ')
        || (b.ctrl && k === 'control') || (b.alt && k === 'alt') || (b.shift && k === 'shift') || (b.meta && k === 'meta')
      if (released) { pttHeld.current = false; useVoice.getState().deactivatePtt() }
    }

    // Fenêtre qui perd le focus alors que la touche est enfoncée : sans ça le
    // micro restait ouvert jusqu'au prochain appui.
    const onBlur = () => {
      if (pttHeld.current) { pttHeld.current = false; useVoice.getState().deactivatePtt() }
    }

    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
    }
     
  }, [joined, pttMode, screenSharing, custom])

  // ── Raccourci GLOBAL (application bureau) ───────────────────────────────
  useEffect(() => {
    if (!isTauri || !joined || !pttMode) return
    let cancelled = false
    const unlisteners: Array<() => void> = []

    ;(async () => {
      try {
        const [{ invoke }, { listen }] = await Promise.all([
          import('@tauri-apps/api/core'),
          import('@tauri-apps/api/event'),
        ])
        const accelerator = toAccelerator(binding('push_to_talk'))
        if (!accelerator) return
        await invoke('register_ptt_shortcut', { accelerator })
        if (cancelled) { await invoke('unregister_ptt_shortcut').catch(() => {}); return }
        unlisteners.push(await listen('ptt-down', () => useVoice.getState().activatePtt()))
        unlisteners.push(await listen('ptt-up', () => useVoice.getState().deactivatePtt()))
      } catch (e) {
        console.warn('[voice] raccourci global indisponible', e)
      }
    })()

    return () => {
      cancelled = true
      unlisteners.forEach(fn => fn())
      import('@tauri-apps/api/core')
        .then(({ invoke }) => invoke('unregister_ptt_shortcut'))
        .catch(() => {})
    }
     
  }, [joined, pttMode, custom])

  return null
}
