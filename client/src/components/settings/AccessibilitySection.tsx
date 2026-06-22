import { useState, useEffect } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import api from '../../api/client'
import toast from 'react-hot-toast'

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${value ? 'bg-fc-accent' : 'bg-fc-hover'}`}
    >
      <span className={`inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
    </button>
  )
}

function Select({ value, onChange, options, className = '' }: {
  value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]; className?: string
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white focus:border-fc-accent outline-none ${className}`}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export default function AccessibilitySection() {
  const { data: settings, refetch } = useQuery({
    queryKey: ['user-settings'],
    queryFn: () => api.get('/user/settings').then(r => r.data),
    staleTime: 60_000,
  })

  const save = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.put('/user/settings', data),
    onSuccess: () => { toast.success('Sauvegardé'); refetch() },
  })

  const [reduceMotion, setReduceMotion] = useState(false)
  const [highContrast, setHighContrast] = useState(false)
  const [colorblindMode, setColorblindMode] = useState('none')

  useEffect(() => {
    if (settings) {
      setReduceMotion(settings.reduce_motion ?? false)
      setHighContrast(settings.high_contrast ?? false)
      setColorblindMode(settings.colorblind_mode ?? 'none')
    }
  }, [settings])

  const applyHighContrast = (v: boolean) => {
    setHighContrast(v)
    document.documentElement.classList.toggle('high-contrast', v)
  }

  const applyReduceMotion = (v: boolean) => {
    setReduceMotion(v)
    document.documentElement.classList.toggle('reduce-motion', v)
  }

  return (
    <div className="space-y-4">
      {[
        { label: 'Réduire les animations', desc: "Moins d'effets visuels et de transitions", value: reduceMotion, onChange: applyReduceMotion },
        { label: 'Contraste élevé', desc: 'Améliore la lisibilité des textes', value: highContrast, onChange: applyHighContrast },
      ].map(item => (
        <div key={item.label} className="flex items-center justify-between p-4 bg-fc-channel rounded-xl border border-fc-hover">
          <div>
            <div className="text-sm font-medium text-white">{item.label}</div>
            <div className="text-xs text-fc-muted">{item.desc}</div>
          </div>
          <Toggle value={item.value} onChange={item.onChange} />
        </div>
      ))}

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-fc-muted uppercase tracking-wide">Mode daltonisme</label>
        <Select value={colorblindMode} onChange={setColorblindMode} className="w-full"
          options={[
            { value: 'none', label: 'Aucun' },
            { value: 'deuteranopia', label: 'Deutéranopie (rouge-vert)' },
            { value: 'protanopia', label: 'Protanopie (rouge)' },
            { value: 'tritanopia', label: 'Tritanopie (bleu-jaune)' },
          ]} />
      </div>

      <button
        onClick={() => save.mutate({ reduce_motion: reduceMotion, high_contrast: highContrast, colorblind_mode: colorblindMode })}
        disabled={save.isPending}
        className="w-full py-2.5 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg font-medium text-sm transition disabled:opacity-50"
      >
        {save.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
      </button>
    </div>
  )
}
