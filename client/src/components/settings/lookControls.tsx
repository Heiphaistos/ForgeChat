import { clampInt } from '../../lib/nameStyle'

/** Petits contrôles partagés par l'éditeur d'anneau et l'éditeur de carte de profil. */

/** Choix exclusif en pastilles (radiogroup accessible au clavier : Tab puis Entrée/Espace). */
export function Chips<T extends string>({ label, value, options, labelOf, onChange }: {
  label: string; value: T; options: readonly T[]; labelOf: (v: T) => string; onChange: (v: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-1.5 text-xs text-fc-muted">
      <span className="w-32 flex-shrink-0">{label}</span>
      {options.map(o => (
        <button key={o} type="button" role="radio" aria-checked={value === o} onClick={() => onChange(o)}
          className={`px-2.5 py-1 rounded-md border transition ${value === o ? 'border-fc-accent bg-fc-accent/10 text-white' : 'border-fc-hover hover:border-fc-muted'}`}>
          {labelOf(o)}
        </button>
      ))}
    </div>
  )
}

/** Curseur borné : la valeur affichée est dans le libellé. */
export function RangeRow({ label, value, min, max, step = 1, onChange, disabled }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; disabled?: boolean
}) {
  return (
    <label className={`flex items-center gap-3 text-xs text-fc-muted ${disabled ? 'opacity-50' : ''}`}>
      <span className="w-40 flex-shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={e => onChange(clampInt(Number(e.target.value), min, max))}
        className="flex-1 accent-fc-accent" aria-label={label} />
    </label>
  )
}
