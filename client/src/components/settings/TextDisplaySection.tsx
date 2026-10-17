import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Field, Select } from './shared'
import api from '../../api/client'
import toast from 'react-hot-toast'
import { useT } from '../../i18n'
import { getAvatarAnimation, setAvatarAnimation, type AvatarAnimation } from '../ui/AnimatedImg'
import { ComposerPrefs, MessageDisplayPrefs } from './UxPrefControls'

export default function TextDisplaySection() {
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

  const [emojiStyle, setEmojiStyle] = useState('native')
  const [timeFormat, setTimeFormat] = useState('24h')
  const [dateFormat, setDateFormat] = useState('DD/MM/YYYY')
  const [timestamps, setTimestamps] = useState('hover')
  const [gifAutoplay, setGifAutoplay] = useState('always')
  const [messageGrouping, setMessageGrouping] = useState(5)
  const [avatarAnim, setAvatarAnim] = useState<AvatarAnimation>(getAvatarAnimation)

  useEffect(() => {
    if (settings) {
      setEmojiStyle(settings.emoji_style ?? 'native')
      setTimeFormat(settings.time_format ?? '24h')
      setDateFormat(settings.date_format ?? 'DD/MM/YYYY')
      setTimestamps(settings.show_timestamps ?? 'hover')
      setGifAutoplay(settings.gif_autoplay ?? 'always')
      setMessageGrouping(settings.message_grouping_minutes ?? 5)
    }
  }, [settings])

  return (
    <div className="space-y-6">
      <Field label={t('settings.text.emoji')}>
        <Select value={emojiStyle} onChange={setEmojiStyle} className="w-full"
          options={[{ value: 'native', label: t('settings.text.emojiNative') }, { value: 'twemoji', label: 'Twemoji (Twitter)' }]} />
      </Field>

      <Field label={t('settings.text.timeFormat')}>
        <Select value={timeFormat} onChange={setTimeFormat} className="w-full"
          options={[{ value: '24h', label: t('settings.text.h24') }, { value: '12h', label: t('settings.text.h12') }]} />
      </Field>

      <Field label={t('settings.text.dateFormat')}>
        <Select value={dateFormat} onChange={setDateFormat} className="w-full"
          options={[
            { value: 'DD/MM/YYYY', label: t('settings.text.dmy') },
            { value: 'MM/DD/YYYY', label: t('settings.text.mdy') },
            { value: 'YYYY-MM-DD', label: 'ISO (2025-12-31)' },
          ]} />
      </Field>

      <Field label={t('settings.text.timestamps')}>
        <Select value={timestamps} onChange={setTimestamps} className="w-full"
          options={[
            { value: 'always', label: t('settings.text.alwaysVisible') },
            { value: 'hover', label: t('settings.text.hover') },
            { value: 'never', label: t('settings.text.never') },
          ]} />
      </Field>

      <Field label={t('settings.text.gif')}>
        <Select value={gifAutoplay} onChange={setGifAutoplay} className="w-full"
          options={[
            { value: 'always', label: t('settings.text.always') },
            { value: 'hover', label: t('settings.text.hover') },
            { value: 'never', label: t('settings.text.never') },
          ]} />
      </Field>

      <Field label={t('settings.text.animateAvatars')} hint={t('settings.text.animateAvatarsHint')}>
        <Select value={avatarAnim} onChange={v => { setAvatarAnim(v as AvatarAnimation); setAvatarAnimation(v as AvatarAnimation) }} className="w-full"
          options={[
            { value: 'always', label: t('settings.text.always') },
            { value: 'hover', label: t('settings.text.hover') },
            { value: 'never', label: t('settings.text.never') },
          ]} />
      </Field>

      <Field label={t('settings.text.grouping', { n: messageGrouping })}>
        <input type="range" min={1} max={30} value={messageGrouping}
          onChange={e => setMessageGrouping(Number(e.target.value))}
          className="w-full accent-fc-accent" />
      </Field>

      <button
        onClick={() => save.mutate({ emoji_style: emojiStyle, time_format: timeFormat, date_format: dateFormat, show_timestamps: timestamps, gif_autoplay: gifAutoplay, message_grouping_minutes: messageGrouping })}
        disabled={save.isPending}
        className="w-full py-2.5 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg font-medium text-sm transition disabled:opacity-50"
      >
        {save.isPending ? t('common.saving') : t('common.save')}
      </button>

      {/* Réglages de cet appareil, appliqués tout de suite (sans « Sauvegarder ») */}
      <p className="text-xs text-fc-muted">{t('ux.deviceOnly')}</p>
      <MessageDisplayPrefs />
      <ComposerPrefs />
    </div>
  )
}
