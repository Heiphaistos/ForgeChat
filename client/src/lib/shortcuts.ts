// Raccourcis clavier personnalisables (web et bureau). Module pur, sans import :
// testé par scripts/shortcuts.test.mjs. Les raccourcis enregistrés vivent sur le
// serveur (/user/keybindings, une ligne { action, key_combo } par raccourci modifié).

export type ShortcutGroup = 'nav' | 'chat' | 'voice'

export interface ShortcutDef {
  action: string
  default: string
  group: ShortcutGroup
  /** Touche seule autorisée (push-to-talk) ; sinon Ctrl, Alt, Meta ou une touche F1-F12 est exigé. */
  bareKey?: boolean
}

// `search` = palette de commandes : identifiant historique gardé pour les raccourcis déjà enregistrés.
export const SHORTCUTS: readonly ShortcutDef[] = [
  { action: 'search', default: 'Ctrl+K', group: 'nav' },
  { action: 'quick_switcher', default: 'Ctrl+Shift+K', group: 'nav' },
  { action: 'shortcuts_help', default: 'Ctrl+/', group: 'nav' },
  { action: 'open_settings', default: 'Ctrl+,', group: 'nav' },
  { action: 'next_unread', default: 'Alt+ArrowDown', group: 'nav' },
  { action: 'prev_unread', default: 'Alt+ArrowUp', group: 'nav' },
  { action: 'next_server', default: 'Ctrl+Alt+ArrowDown', group: 'nav' },
  { action: 'prev_server', default: 'Ctrl+Alt+ArrowUp', group: 'nav' },
  { action: 'lock_app', default: 'Ctrl+Shift+L', group: 'nav' },
  { action: 'mark_all_read', default: 'Ctrl+Shift+A', group: 'chat' },
  { action: 'search_channel', default: 'Ctrl+F', group: 'chat' },
  { action: 'toggle_split', default: 'Ctrl+Shift+S', group: 'chat' },
  { action: 'toggle_mute', default: 'Ctrl+Shift+M', group: 'voice' },
  { action: 'toggle_deafen', default: 'Ctrl+Shift+D', group: 'voice' },
  { action: 'push_to_talk', default: 'Ctrl+Shift+Space', group: 'voice', bareKey: true },
  { action: 'toggle_screen_share', default: 'Ctrl+Alt+S', group: 'voice' },
  { action: 'toggle_camera', default: 'Ctrl+Shift+C', group: 'voice' },
  { action: 'clip_stream', default: 'Alt+C', group: 'voice' },
]

const DEFAULTS: Record<string, string> = Object.fromEntries(SHORTCUTS.map(s => [s.action, s.default]))

// Raccourcis du navigateur ou du système qu'on ne laisse pas prendre.
const RESERVED = new Set(['ctrl+w', 'ctrl+t', 'ctrl+n', 'ctrl+q', 'ctrl+r', 'ctrl+shift+t', 'ctrl+shift+n',
  'ctrl+shift+i', 'ctrl+c', 'ctrl+v', 'ctrl+x', 'ctrl+z', 'ctrl+y', 'ctrl+a', 'alt+f4', 'f5', 'f11', 'f12'])

export interface Combo { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; key: string }

/** « Ctrl+Shift+K » → éléments ; la touche « + » elle-même s'écrit « Ctrl++ ». */
export function parseCombo(binding: string): Combo {
  const s = binding.trim()
  const plusKey = s.endsWith('++') || s === '+'
  const parts = (plusKey ? s.slice(0, -1) : s).split('+').map(p => p.trim()).filter(Boolean)
  const c: Combo = { ctrl: false, alt: false, shift: false, meta: false, key: plusKey ? '+' : '' }
  for (const p of parts) {
    const low = p.toLowerCase()
    if (low === 'ctrl' || low === 'control') c.ctrl = true
    else if (low === 'alt') c.alt = true
    else if (low === 'shift') c.shift = true
    else if (low === 'meta' || low === 'cmd' || low === 'super') c.meta = true
    else c.key = low === ' ' || low === 'espace' ? 'space' : low
  }
  return c
}

/** Forme canonique (comparaisons et conflits) : modificateurs dans un ordre fixe, touche en minuscules. */
export function canonical(binding: string): string {
  const c = parseCombo(binding)
  if (!c.key) return ''
  return [c.ctrl && 'ctrl', c.alt && 'alt', c.shift && 'shift', c.meta && 'meta', c.key].filter(Boolean).join('+')
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>

/** Raccourci saisi au clavier ; '' tant que seule une touche de modification est enfoncée. */
export function comboFromEvent(e: KeyLike): string {
  if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(e.key)) return ''
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Meta')
  parts.push(e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key)
  return parts.join('+')
}

/** Ctrl s'entend aussi de Cmd sur Mac quand le raccourci ne demande pas Meta. */
export function matches(e: KeyLike, binding: string): boolean {
  const b = parseCombo(binding)
  if (!b.key) return false
  if (b.meta ? !e.metaKey || e.ctrlKey !== b.ctrl : (e.ctrlKey || e.metaKey) !== b.ctrl) return false
  if (e.altKey !== b.alt) return false
  const k = e.key.toLowerCase()
  // Shift change la touche des symboles (« ? » au lieu de « / ») : on ne l'exige
  // strictement que pour les lettres, chiffres et touches nommées.
  if (e.shiftKey !== b.shift && (k.length > 1 || /[a-z0-9]/.test(k))) return false
  return k === b.key || (b.key === 'space' && k === ' ')
}

/** Raccourcis effectifs : défauts + raccourcis enregistrés (actions inconnues ignorées). */
export function resolveBindings(saved: readonly { action: string; key_combo: string }[] | unknown): Record<string, string> {
  const out = { ...DEFAULTS }
  if (Array.isArray(saved)) {
    for (const k of saved) {
      if (k && typeof k.action === 'string' && typeof k.key_combo === 'string' && k.action in out) out[k.action] = k.key_combo
    }
  }
  return out
}

/** Actions partageant le même raccourci, par action : { a: ['b'], b: ['a'] }. */
export function findConflicts(bindings: Record<string, string>): Record<string, string[]> {
  const byCombo = new Map<string, string[]>()
  for (const [action, combo] of Object.entries(bindings)) {
    const key = canonical(combo)
    if (key) byCombo.set(key, [...(byCombo.get(key) ?? []), action])
  }
  const out: Record<string, string[]> = {}
  for (const actions of byCombo.values()) {
    if (actions.length < 2) continue
    for (const a of actions) out[a] = actions.filter(x => x !== a)
  }
  return out
}

export type ComboProblem = 'empty' | 'reserved' | 'needsModifier' | 'tooLong'

/** Pourquoi un raccourci est refusé (null = accepté). */
export function comboProblem(action: string, binding: string): ComboProblem | null {
  if (binding.length > 40) return 'tooLong'
  const key = canonical(binding)
  if (!key) return 'empty'
  if (RESERVED.has(key)) return 'reserved'
  const c = parseCombo(binding)
  const def = SHORTCUTS.find(s => s.action === action)
  if (!c.ctrl && !c.alt && !c.meta && !/^f([1-9]|1[0-2])$/.test(c.key) && !def?.bareKey) return 'needsModifier'
  return null
}

/** Affichage lisible (« Ctrl + Maj + K ») d'un raccourci. */
export function prettyCombo(binding: string, lang: 'fr' | 'en' = 'fr'): string {
  const c = parseCombo(binding)
  const names: Record<string, [string, string]> = {
    arrowup: ['↑', '↑'], arrowdown: ['↓', '↓'], arrowleft: ['←', '←'], arrowright: ['→', '→'],
    space: ['Espace', 'Space'], escape: ['Échap', 'Esc'],
  }
  const i = lang === 'fr' ? 0 : 1
  const key = names[c.key]?.[i] ?? (c.key.length === 1 ? c.key.toUpperCase() : c.key.charAt(0).toUpperCase() + c.key.slice(1))
  return [c.ctrl && 'Ctrl', c.alt && 'Alt', c.shift && (lang === 'fr' ? 'Maj' : 'Shift'), c.meta && 'Meta', key]
    .filter(Boolean).join(' + ')
}
