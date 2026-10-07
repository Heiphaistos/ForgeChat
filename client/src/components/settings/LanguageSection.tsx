import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Field, Select } from './shared'
import api from '../../api/client'
import toast from 'react-hot-toast'
import { useT, useLang } from '../../i18n'

const LANGS = [
  { value: 'fr', label: '🇫🇷 Français' }, { value: 'en', label: '🇬🇧 English' },
  { value: 'es', label: '🇪🇸 Español' }, { value: 'de', label: '🇩🇪 Deutsch' },
  { value: 'pt', label: '🇧🇷 Português' }, { value: 'ja', label: '🇯🇵 日本語' },
  { value: 'ko', label: '🇰🇷 한국어' }, { value: 'zh', label: '🇨🇳 中文' },
]

export default function LanguageSection() {
  const t = useT()
  const setLang = useLang(s => s.setLang)
  const { data: settings, refetch } = useQuery({
    queryKey: ['user-settings'],
    queryFn: () => api.get('/user/settings').then(r => r.data),
    staleTime: 60_000,
  })
  const save = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.put('/user/settings', data),
    // Applique la langue tout de suite (sans recharger), puis confirme dans la nouvelle langue
    onSuccess: (_r, data) => { setLang(data.language as string); toast.success(t('common.saved')); refetch() },
  })
  const [language, setLanguage] = useState('fr')

  useEffect(() => { if (settings) setLanguage(settings.language ?? 'fr') }, [settings])

  return (
    <div className="space-y-4">
      <Field label={t('settings.language.label')} hint={language !== 'fr' && language !== 'en' ? t('settings.language.partial') : undefined}>
        <Select value={language} onChange={setLanguage} className="w-full" options={LANGS} />
      </Field>
      <button
        onClick={() => save.mutate({ language })}
        disabled={save.isPending}
        className="w-full py-2.5 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg font-medium text-sm transition disabled:opacity-50"
      >
        {save.isPending ? t('common.saving') : t('common.save')}
      </button>
    </div>
  )
}
