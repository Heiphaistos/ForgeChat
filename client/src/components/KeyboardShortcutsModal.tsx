import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { SHORTCUTS, prettyCombo } from '../lib/shortcuts'
import { shortcutLabel, useShortcutBindings } from '../hooks/useShortcuts'
import { useLang, useT, type Key } from '../i18n'

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

// Raccourcis fixes (saisie) ; les raccourcis réglables viennent des Réglages.
const fixedGroups = (t: (k: Key) => string): ShortcutGroup[] => [
  {
    title: t('hc.ks.messages'),
    shortcuts: [
      { keys: ['a–z'], description: t('hc.ks.write') },
      { keys: ['↑'], description: t('hc.ks.editLast') },
      { keys: ['Ctrl', 'Enter'], description: t('hc.ks.send') },
      { keys: ['Shift', 'Enter'], description: t('hc.ks.newline') },
      { keys: ['PgUp', '/', 'PgDn'], description: t('hc.ks.page') },
      { keys: ['Home', '/', 'End'], description: t('hc.ks.topBottom') },
    ],
  },
  {
    title: t('hc.ks.fmt'),
    shortcuts: [
      { keys: ['Ctrl', 'B'], description: t('hc.ks.bold') },
      { keys: ['Ctrl', 'I'], description: t('hc.ks.italic') },
      { keys: ['Ctrl', 'U'], description: t('hc.ks.underline') },
      { keys: ['Ctrl', 'Shift', 'X'], description: t('hc.ks.strike') },
      { keys: ['Ctrl', 'K'], description: t('hc.ks.link') },
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
  const t = useT()
  const lang = useLang(s => s.lang)
  const nav = useNavigate()
  const bindings = useShortcutBindings()
  const custom: ShortcutGroup[] = (['nav', 'chat', 'voice'] as const).map(g => ({
    title: t(`keys.group.${g}` as Key),
    shortcuts: SHORTCUTS.filter(s => s.group === g).map(s => ({
      keys: prettyCombo(bindings[s.action], lang).split(' + '),
      description: t(shortcutLabel(s.action)),
    })),
  }))
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
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="kbd-shortcuts-title"
        className="bg-fc-channel w-full max-w-lg rounded-xl shadow-2xl border border-white/10 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h2 id="kbd-shortcuts-title" className="text-white font-bold text-base">{t('hc.ks.title')}</h2>
          <button
            onClick={onClose}
            aria-label={t('hc.ks.close')}
            className="p-1 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"
          >
            <X size={16} />
          </button>
        </div>

        {/* Contenu */}
        <div className="overflow-y-auto overscroll-contain max-h-[70vh] p-5 grid gap-5">
          {[...custom, ...fixedGroups(t)].map(group => (
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
          <button onClick={() => { onClose(); nav('/settings?section=keybindings') }} className="text-xs text-fc-accent hover:underline">
            {t('keys.helpEdit')}
          </button>
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
