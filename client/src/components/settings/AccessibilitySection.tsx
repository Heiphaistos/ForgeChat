import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Toggle, Select, Field } from './shared'
import api from '../../api/client'
import toast from 'react-hot-toast'
import { useT } from '../../i18n'
import { AccessibilityPrefs } from './UxPrefControls'
import { DensityChoice } from './appearance/LayoutSettings'

export default function AccessibilitySection() {
  const t = useT()
  const { data: settings, refetch } = useQuery({
    queryKey: ['user-settings'],
    queryFn: () => api.get('/user/settings').then(r => r.data),
    staleTime: 60_000,
  })
  const save = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.put('/user/settings', data),
    onSuccess: () => { toast.success(t('common.saved')); refetch() },
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

  const handleReduceMotion = (val: boolean) => {
    setReduceMotion(val)
    document.documentElement.setAttribute('data-reduce-motion', String(val))
  }

  const handleHighContrast = (val: boolean) => {
    setHighContrast(val)
    document.documentElement.setAttribute('data-high-contrast', String(val))
  }

  return (
    <div className="space-y-4">
      {[
        { label: t('settings.access.reduceMotion'), desc: t('settings.access.reduceMotionDesc'), value: reduceMotion, onChange: handleReduceMotion },
        { label: t('settings.access.highContrast'), desc: t('settings.access.highContrastDesc'), value: highContrast, onChange: handleHighContrast },
      ].map(item => (
        <div key={item.label} className="flex items-center justify-between p-4 bg-fc-channel rounded-xl border border-fc-hover">
          <div>
            <div className="text-sm font-medium text-white">{item.label}</div>
            <div className="text-xs text-fc-muted">{item.desc}</div>
          </div>
          <Toggle value={item.value} onChange={item.onChange} label={item.label} />
        </div>
      ))}

      <Field label={t('settings.access.colorblind')}>
        <Select value={colorblindMode} onChange={setColorblindMode} className="w-full"
          options={[
            { value: 'none', label: t('settings.access.none') },
            { value: 'deuteranopia', label: t('settings.access.deuteranopia') },
            { value: 'protanopia', label: t('settings.access.protanopia') },
            { value: 'tritanopia', label: t('settings.access.tritanopia') },
          ]} />
      </Field>

      <button
        onClick={() => save.mutate({ reduce_motion: reduceMotion, high_contrast: highContrast, colorblind_mode: colorblindMode })}
        disabled={save.isPending}
        className="w-full py-2.5 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg font-medium text-sm transition disabled:opacity-50"
      >
        {save.isPending ? t('common.saving') : t('common.save')}
      </button>

      <p className="text-xs text-fc-muted">{t('ux.deviceOnly')}</p>
      <DensityChoice />
      <AccessibilityPrefs />
    </div>
  )
}
