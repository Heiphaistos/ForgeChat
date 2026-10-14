import React, { createContext, useContext } from 'react'

/** Libellé du `Field` englobant : repris par `Select` en aria-label (le <label> n'est pas lié au contrôle). */
const FieldLabelCtx = createContext<string | undefined>(undefined)

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-fc-muted uppercase tracking-wide">{label}</label>
      <FieldLabelCtx.Provider value={label}>{children}</FieldLabelCtx.Provider>
      {hint && <p className="text-xs text-fc-muted">{hint}</p>}
    </div>
  )
}

/** Interrupteur ; `label` : nom lu par les lecteurs d'écran (WCAG 4.1.2, amélioration n° 41). */
export function Toggle({ value, onChange, label, disabled }: { value: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${value ? 'bg-fc-accent' : 'bg-fc-hover'}`}
    >
      <span className={`inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
    </button>
  )
}

export function Select({ value, onChange, options, className = '', label }: {
  value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]; className?: string
  /** Nom accessible ; par défaut le libellé du `Field` englobant. */
  label?: string
}) {
  const fieldLabel = useContext(FieldLabelCtx)
  return (
    <select
      aria-label={label ?? fieldLabel}
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white focus:border-fc-accent outline-none ${className}`}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}
