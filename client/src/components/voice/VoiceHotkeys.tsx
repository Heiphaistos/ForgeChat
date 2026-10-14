import { useEffect, useRef } from 'react'
import { matches, parseCombo } from '../../lib/shortcuts'
import { useShortcutBindings } from '../../hooks/useShortcuts'
import { useVoice } from '../../store/voice'
import { useClipsSetting } from '../../lib/clipBuffer'
import toast from 'react-hot-toast'
import { errText } from '../../lib/desktop'
import { t } from '../../i18n'

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

/** Convertit un raccourci ForgeChat en accélérateur global Tauri (KeyboardEvent.code). */
function toAccelerator(binding: string): string {
  const b = parseCombo(binding)
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

  // Raccourcis effectifs (défauts + Réglages), mêmes données que le reste de l'appli.
  const custom = useShortcutBindings()
  const binding = (action: string) => custom[action] ?? ''

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
      // Clip : géré par la page du salon vocal, qui détient les tampons.
      if (useClipsSetting.getState().enabled && matches(e, binding('clip_stream'))) {
        e.preventDefault(); window.dispatchEvent(new Event('fc:clip')); return
      }
      if (matches(e, binding('toggle_screen_share'))) {
        e.preventDefault()
        const st = useVoice.getState()
        if (st.screenSharing) void st.stopScreenShare()
        else void st.shareScreen()
      }
    }

    const onUp = (e: KeyboardEvent) => {
      if (!pttMode || !pttHeld.current) return
      const b = parseCombo(binding('push_to_talk'))
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
        // Le bureau refuse une touche seule sans modificateur (sauf F1-F24) : on le dit à l'utilisateur.
        await invoke('register_ptt_shortcut', { accelerator }).catch((e: unknown) => {
          toast.error(t('ptt.globalRefused', { err: errText(e) }), { id: 'ptt-global', duration: 8000 })
          throw e
        })
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
