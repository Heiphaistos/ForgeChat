import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Field, Select } from './shared'
import api from '../../api/client'
import toast from 'react-hot-toast'

const LANGS = [
  { value: 'fr', label: '🇫🇷 Français' }, { value: 'en', label: '🇬🇧 English' },
  { value: 'es', label: '🇪🇸 Español' }, { value: 'de', label: '🇩🇪 Deutsch' },
  { value: 'pt', label: '🇧🇷 Português' }, { value: 'ja', label: '🇯🇵 日本語' },
  { value: 'ko', label: '🇰🇷 한국어' }, { value: 'zh', label: '🇨🇳 中文' },
]

export default function LanguageSection() {
  const { data: settings, refetch } = useQuery({
    queryKey: ['user-settings'],
    queryFn: () => api.get('/user/settings').then(r => r.data),
    staleTime: 60_000,
  })
  const save = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.put('/user/settings', data),
    onSuccess: () => { toast.success('Sauvegardé'); refetch() },
  })
  const [language, setLanguage] = useState('fr')

  useEffect(() => { if (settings) setLanguage(settings.language ?? 'fr') }, [settings])

  return (
    <div className="space-y-4">
      <Field label="Langue de l'interface">
        <Select value={language} onChange={setLanguage} className="w-full" options={LANGS} />
      </Field>
      <button
        onClick={() => save.mutate({ language })}
        disabled={save.isPending}
        className="w-full py-2.5 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg font-medium text-sm transition disabled:opacity-50"
      >
        {save.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
      </button>
    </div>
  )
}
