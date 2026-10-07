// Petits éléments communs aux réglages du lot communauté.
import type { ReactNode } from 'react'

export const inputCls = 'w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm'
export const btnCls = 'px-4 py-2 bg-fc-accent hover:bg-indigo-500 disabled:opacity-50 text-white rounded text-sm font-medium transition'

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} role="switch" aria-checked={checked} aria-label={label}
      className={`w-11 h-6 rounded-full transition relative flex-shrink-0 ${checked ? 'bg-fc-green' : 'bg-fc-muted'}`}>
      <span className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${checked ? 'left-6' : 'left-1'}`} />
    </button>
  )
}

export function Section({ title, desc, enabled, onToggle, children }: {
  title: string
  desc?: string
  enabled?: boolean
  onToggle?: (v: boolean) => void
  children?: ReactNode
}) {
  return (
    <section className="p-4 bg-fc-channel rounded-xl space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {desc && <p className="text-xs text-fc-muted mt-0.5">{desc}</p>}
        </div>
        {onToggle && <Toggle checked={!!enabled} onChange={onToggle} label={title} />}
      </div>
      {children}
    </section>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">{label}</span>
      {children}
    </label>
  )
}

/** Choix d'un salon texte du serveur. */
export function ChannelSelect({ value, onChange, channels, label, allowNone }: {
  value: string | null
  onChange: (v: string | null) => void
  channels: { id: string; name: string; type?: string }[]
  label: string
  allowNone?: string
}) {
  return (
    <Field label={label}>
      <select value={value ?? ''} onChange={e => onChange(e.target.value || null)} className={inputCls}>
        {allowNone !== undefined && <option value="">{allowNone}</option>}
        {channels.filter(c => !c.type || c.type === 'text' || c.type === 'announcement').map(c => (
          <option key={c.id} value={c.id}>#{c.name}</option>
        ))}
      </select>
    </Field>
  )
}
