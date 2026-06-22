import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Toggle, Select, Field } from './shared'
import api from '../../api/client'
import toast from 'react-hot-toast'

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

  return (
    <div className="space-y-4">
      {[
        { label: 'Réduire les animations', desc: "Moins d'effets visuels et de transitions", value: reduceMotion, onChange: setReduceMotion },
        { label: 'Contraste élevé', desc: 'Améliore la lisibilité des textes', value: highContrast, onChange: setHighContrast },
      ].map(item => (
        <div key={item.label} className="flex items-center justify-between p-4 bg-fc-channel rounded-xl border border-fc-hover">
          <div>
            <div className="text-sm font-medium text-white">{item.label}</div>
            <div className="text-xs text-fc-muted">{item.desc}</div>
          </div>
          <Toggle value={item.value} onChange={item.onChange} />
        </div>
      ))}

      <Field label="Mode daltonisme">
        <Select value={colorblindMode} onChange={setColorblindMode} className="w-full"
          options={[
            { value: 'none', label: 'Aucun' },
            { value: 'deuteranopia', label: 'Deutéranopie (rouge-vert)' },
            { value: 'protanopia', label: 'Protanopie (rouge)' },
            { value: 'tritanopia', label: 'Tritanopie (bleu-jaune)' },
          ]} />
      </Field>

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
