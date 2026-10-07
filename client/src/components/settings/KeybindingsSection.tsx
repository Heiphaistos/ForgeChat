import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RotateCcw, Pencil, X, AlertTriangle } from 'lucide-react'
import api from '../../api/client'
import toast from 'react-hot-toast'
import { useT, useLang, type Key } from '../../i18n'
import { SHORTCUTS, comboFromEvent, comboProblem, canonical, findConflicts, prettyCombo, type ShortcutGroup } from '../../lib/shortcuts'
import { useShortcutBindings, shortcutLabel } from '../../hooks/useShortcuts'

const GROUPS: { id: ShortcutGroup; label: Key }[] = [
  { id: 'nav', label: 'keys.group.nav' },
  { id: 'chat', label: 'keys.group.chat' },
  { id: 'voice', label: 'keys.group.voice' },
]

export default function KeybindingsSection() {
  const t = useT()
  const lang = useLang(s => s.lang)
  const qc = useQueryClient()
  const bindings = useShortcutBindings()
  const conflicts = findConflicts(bindings)
  const [capturing, setCapturing] = useState<string | null>(null)

  const refresh = () => qc.invalidateQueries({ queryKey: ['keybindings'] })
  const setMutation = useMutation({
    mutationFn: (data: { action: string; key_combo: string }) => api.post('/user/keybindings', data),
    onSuccess: () => { refresh(); setCapturing(null); toast.success(t('settings.keys.saved')) },
    onError: () => toast.error(t('common.error')),
  })
  const resetMutation = useMutation({
    mutationFn: (action: string) => api.delete(`/user/keybindings/${encodeURIComponent(action)}`),
    onSuccess: refresh,
  })
  const resetAll = useMutation({
    mutationFn: () => api.delete('/user/keybindings'),
    onSuccess: () => { refresh(); toast.success(t('keys.resetAllDone')) },
    onError: () => toast.error(t('common.error')),
  })
  const save = setMutation.mutate

  useEffect(() => {
    if (!capturing) return
    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') { setCapturing(null); return }
      const combo = comboFromEvent(e)
      if (!combo) return
      const problem = comboProblem(capturing, combo)
      if (problem) { toast.error(t(`keys.problem.${problem}` as Key)); return }
      const taken = SHORTCUTS.find(s => s.action !== capturing && canonical(bindings[s.action]) === canonical(combo))
      if (taken) {
        toast.error(t('keys.conflictWith', { combo: prettyCombo(combo, lang), action: t(shortcutLabel(taken.action)) }))
        return
      }
      save({ action: capturing, key_combo: combo })
    }
    // Phase de capture : aucun raccourci de l'appli ne se déclenche pendant la saisie.
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [capturing, bindings, lang, t, save])

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-fc-muted">{t('settings.keys.intro')}</p>
        <button
          onClick={() => resetAll.mutate()}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-fc-bg border border-fc-hover text-white hover:border-fc-accent transition"
        >
          <RotateCcw size={12} /> {t('keys.resetAll')}
        </button>
      </div>

      {capturing && (
        <div role="status" className="p-3 bg-fc-accent/10 border border-fc-accent rounded-lg text-sm text-white animate-pulse">
          {t('settings.keys.press')}
        </div>
      )}

      {GROUPS.map(g => (
        <section key={g.id} className="space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fc-muted px-1 pt-2">{t(g.label)}</h3>
          {SHORTCUTS.filter(s => s.group === g.id).map(kb => {
            const combo = bindings[kb.action]
            const custom = canonical(combo) !== canonical(kb.default)
            const isCapturing = capturing === kb.action
            const clash = conflicts[kb.action]
            return (
              <div
                key={kb.action}
                className={`flex items-center justify-between gap-2 px-4 py-3 rounded-xl transition ${
                  isCapturing ? 'bg-fc-accent/10 border border-fc-accent' : 'bg-fc-channel border border-transparent hover:border-fc-hover'
                }`}
              >
                <div className="min-w-0">
                  <span className="text-sm text-white">{t(shortcutLabel(kb.action))}</span>
                  {clash && (
                    <p className="flex items-center gap-1 text-xs text-amber-400 mt-0.5">
                      <AlertTriangle size={11} aria-hidden />
                      {t('keys.conflictShort', { action: clash.map(a => t(shortcutLabel(a))).join(', ') })}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => setCapturing(isCapturing ? null : kb.action)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-mono transition ${
                      isCapturing ? 'bg-fc-accent text-white' : 'bg-fc-bg border border-fc-hover text-white hover:border-fc-accent'
                    }`}
                  >
                    {isCapturing ? <X size={10} /> : <Pencil size={10} />}
                    {isCapturing ? t('common.cancel') : prettyCombo(combo, lang)}
                  </button>
                  {custom && (
                    <button
                      onClick={() => resetMutation.mutate(kb.action)}
                      title={t('settings.keys.reset', { combo: prettyCombo(kb.default, lang) })}
                      aria-label={t('settings.keys.reset', { combo: prettyCombo(kb.default, lang) })}
                      className="p-1.5 text-fc-muted hover:text-white rounded transition"
                    >
                      <RotateCcw size={12} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}
