// Petite fenêtre de saisie d'une ligne (renommer une catégorie, statut d'un salon vocal).
// Même gabarit que les autres fenêtres (div fixe, z-50) : pas de <dialog> modal, dont la couche
// supérieure masquerait les toasts d'erreur et rendrait ConfirmModal inerte.
import { useState } from 'react'
import { useT } from '../../i18n'
import { useEscapeKey } from '../../hooks/useEscapeKey'

interface Props {
  title: string
  label: string
  initial?: string
  placeholder?: string
  maxLength: number
  /** Autorise l'enregistrement d'une valeur vide (= effacer). */
  allowEmpty?: boolean
  busy?: boolean
  onSubmit: (value: string) => void
  onClose: () => void
}

export default function TextPromptDialog({ title, label, initial = '', placeholder, maxLength, allowEmpty, busy, onSubmit, onClose }: Props) {
  const t = useT()
  useEscapeKey(onClose)
  const [value, setValue] = useState(initial)
  const empty = !value.trim()
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <form role="dialog" aria-modal="true" aria-labelledby="fc-text-prompt-title"
        onSubmit={e => { e.preventDefault(); if (!busy && (allowEmpty || !empty)) onSubmit(value.trim()) }}
        className="relative bg-fc-sidebar border border-white/10 rounded-xl shadow-2xl p-5 w-full max-w-sm">
        <h3 id="fc-text-prompt-title" className="text-white font-semibold mb-3">{title}</h3>
        <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5" htmlFor="fc-text-prompt">{label}</label>
        <input id="fc-text-prompt" autoFocus value={value} onChange={e => setValue(e.target.value)} maxLength={maxLength}
          placeholder={placeholder} autoComplete="off" enterKeyHint="done"
          className="w-full px-3 py-2 bg-fc-input rounded-lg text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm" />
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-fc-muted hover:text-white transition">{t('common.cancel')}</button>
          <button type="submit" disabled={busy || (!allowEmpty && empty)}
            className="px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition disabled:opacity-50">
            {t('common.save')}
          </button>
        </div>
      </form>
    </div>
  )
}
