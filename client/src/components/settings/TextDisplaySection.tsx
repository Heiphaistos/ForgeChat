import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Field, Toggle, Select } from './shared'
import api from '../../api/client'
import toast from 'react-hot-toast'

export default function TextDisplaySection() {
  const { data: settings, refetch } = useQuery({
    queryKey: ['user-settings'],
    queryFn: () => api.get('/user/settings').then(r => r.data),
    staleTime: 60_000,
  })

  const save = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.put('/user/settings', data),
    onSuccess: () => { toast.success('Sauvegardé'); refetch() },
  })

  const [emojiStyle, setEmojiStyle] = useState('native')
  const [timeFormat, setTimeFormat] = useState('24h')
  const [dateFormat, setDateFormat] = useState('DD/MM/YYYY')
  const [timestamps, setTimestamps] = useState('hover')
  const [gifAutoplay, setGifAutoplay] = useState('always')
  const [linkPreview, setLinkPreview] = useState(true)
  const [messageGrouping, setMessageGrouping] = useState(5)

  useEffect(() => {
    if (settings) {
      setEmojiStyle(settings.emoji_style ?? 'native')
      setTimeFormat(settings.time_format ?? '24h')
      setDateFormat(settings.date_format ?? 'DD/MM/YYYY')
      setTimestamps(settings.show_timestamps ?? 'hover')
      setGifAutoplay(settings.gif_autoplay ?? 'always')
      setLinkPreview(settings.link_preview ?? true)
      setMessageGrouping(settings.message_grouping_minutes ?? 5)
    }
  }, [settings])

  return (
    <div className="space-y-6">
      <Field label="Style d'emojis">
        <Select value={emojiStyle} onChange={setEmojiStyle} className="w-full"
          options={[{ value: 'native', label: 'Emojis natifs du système' }, { value: 'twemoji', label: 'Twemoji (Twitter)' }]} />
      </Field>

      <Field label="Format de l'heure">
        <Select value={timeFormat} onChange={setTimeFormat} className="w-full"
          options={[{ value: '24h', label: '24 heures (14:30)' }, { value: '12h', label: '12 heures (2:30 PM)' }]} />
      </Field>

      <Field label="Format de date">
        <Select value={dateFormat} onChange={setDateFormat} className="w-full"
          options={[
            { value: 'DD/MM/YYYY', label: 'JJ/MM/AAAA (31/12/2025)' },
            { value: 'MM/DD/YYYY', label: 'MM/JJ/AAAA (12/31/2025)' },
            { value: 'YYYY-MM-DD', label: 'ISO (2025-12-31)' },
          ]} />
      </Field>

      <Field label="Affichage des horodatages">
        <Select value={timestamps} onChange={setTimestamps} className="w-full"
          options={[
            { value: 'always', label: 'Toujours visible' },
            { value: 'hover', label: 'Au survol' },
            { value: 'never', label: 'Jamais' },
          ]} />
      </Field>

      <Field label="Lecture automatique des GIFs">
        <Select value={gifAutoplay} onChange={setGifAutoplay} className="w-full"
          options={[
            { value: 'always', label: 'Toujours' },
            { value: 'hover', label: 'Au survol' },
            { value: 'never', label: 'Jamais' },
          ]} />
      </Field>

      <Field label={`Délai de regroupement des messages — ${messageGrouping} min`}>
        <input type="range" min={1} max={30} value={messageGrouping}
          onChange={e => setMessageGrouping(Number(e.target.value))}
          className="w-full accent-fc-accent" />
      </Field>

      <div className="flex items-center justify-between p-4 bg-fc-channel rounded-xl border border-fc-hover">
        <div>
          <div className="text-sm font-medium text-white">Prévisualisations de liens</div>
          <div className="text-xs text-fc-muted">Affiche un aperçu des URLs partagées</div>
        </div>
        <Toggle value={linkPreview} onChange={setLinkPreview} />
      </div>

      <button
        onClick={() => save.mutate({ emoji_style: emojiStyle, time_format: timeFormat, date_format: dateFormat, show_timestamps: timestamps, gif_autoplay: gifAutoplay, link_preview: linkPreview, message_grouping_minutes: messageGrouping })}
        disabled={save.isPending}
        className="w-full py-2.5 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg font-medium text-sm transition disabled:opacity-50"
      >
        {save.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
      </button>
    </div>
  )
}
