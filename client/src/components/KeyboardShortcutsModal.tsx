import { useEffect } from 'react'
import { X } from 'lucide-react'

interface Props {
  onClose: () => void
}

interface ShortcutItem {
  keys: string[]
  description: string
}

interface ShortcutGroup {
  title: string
  shortcuts: ShortcutItem[]
}

const GROUPS: ShortcutGroup[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['Ctrl', 'K'], description: 'Quick Switcher' },
      { keys: ['Ctrl', ','], description: 'Paramètres' },
      { keys: ['Escape'], description: 'Fermer / Annuler' },
    ],
  },
  {
    title: 'Messages',
    shortcuts: [
      { keys: ['↑'], description: 'Modifier le dernier message' },
      { keys: ['Ctrl', 'Enter'], description: 'Envoyer le message' },
      { keys: ['Shift', 'Enter'], description: 'Saut de ligne' },
    ],
  },
  {
    title: 'Canaux',
    shortcuts: [
      { keys: ['Alt', '↑'], description: 'Canal non-lu précédent' },
      { keys: ['Alt', '↓'], description: 'Canal non-lu suivant' },
      { keys: ['Ctrl', 'Shift', 'A'], description: 'Marquer tout comme lu' },
      { keys: ['Ctrl', 'Shift', 'S'], description: 'Vue en split' },
      { keys: ['Ctrl', 'F'], description: 'Rechercher dans le canal' },
    ],
  },
  {
    title: 'Vocal',
    shortcuts: [
      { keys: ['P'], description: 'Push-to-Talk (maintenir)' },
      { keys: ['Espace'], description: 'Push-to-Talk (maintenir)' },
      { keys: ['V'], description: 'Toggle caméra' },
      { keys: ['S'], description: 'Screen share / Go Live' },
    ],
  },
  {
    title: 'Formatage messages',
    shortcuts: [
      { keys: ['Ctrl', 'B'], description: 'Gras (**texte**)' },
      { keys: ['Ctrl', 'I'], description: 'Italique (*texte*)' },
      { keys: ['Ctrl', 'U'], description: 'Souligné (__texte__)' },
    ],
  },
  {
    title: 'Interface',
    shortcuts: [
      { keys: ['?'], description: 'Raccourcis clavier (ce modal)' },
    ],
  },
]

function KeyBadge({ label }: { label: string }) {
  return (
    <kbd className="inline-flex items-center justify-center px-1.5 py-0.5 rounded bg-fc-hover border border-white/10 text-[11px] font-mono text-white min-w-[22px] text-center">
      {label}
    </kbd>
  )
}

export default function KeyboardShortcutsModal({ onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-fc-channel w-full max-w-lg rounded-xl shadow-2xl border border-white/10 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h2 className="text-white font-bold text-base">Raccourcis clavier</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"
          >
            <X size={16} />
          </button>
        </div>

        {/* Contenu */}
        <div className="overflow-y-auto max-h-[70vh] p-5 grid gap-5">
          {GROUPS.map(group => (
            <div key={group.title}>
              <p className="text-[11px] font-semibold text-fc-muted uppercase tracking-widest mb-2">
                {group.title}
              </p>
              <div className="flex flex-col gap-1">
                {group.shortcuts.map((sc, i) => (
                  <div key={i} className="flex items-center justify-between py-1 px-2 rounded hover:bg-fc-hover/50 transition">
                    <span className="text-sm text-fc-text">{sc.description}</span>
                    <div className="flex items-center gap-1 flex-shrink-0 ml-4">
                      {sc.keys.map((k, ki) => (
                        <span key={ki} className="flex items-center gap-1">
                          {ki > 0 && <span className="text-fc-muted text-[10px]">+</span>}
                          <KeyBadge label={k} />
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-white/10 flex items-center justify-between">
          <span className="text-xs text-fc-muted">Appuyez sur <KeyBadge label="?" /> pour ouvrir ce panel</span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded bg-fc-accent hover:bg-fc-accent/80 text-white text-sm font-medium transition"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  )
}
