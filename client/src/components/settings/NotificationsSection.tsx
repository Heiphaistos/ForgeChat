import { useState, useEffect } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Moon } from 'lucide-react'
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-fc-muted uppercase tracking-wide">{label}</label>
      {children}
    </div>
  )
}

export default function NotificationsSection() {
  const { data: settings, refetch } = useQuery({
    queryKey: ['user-settings'],
    queryFn: () => api.get('/user/settings').then(r => r.data),
    staleTime: 60_000,
  })

  const save = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.put('/user/settings', data),
    onSuccess: () => { toast.success('Sauvegardé'); refetch() },
  })

  const [quietEnabled, setQuietEnabled] = useState(false)
  const [quietStart, setQuietStart] = useState('22:00')
  const [quietEnd, setQuietEnd] = useState('08:00')
  const [soundMessage, setSoundMessage] = useState(true)
  const [soundMention, setSoundMention] = useState(true)
  const [soundReaction, setSoundReaction] = useState(true)
  const [soundDm, setSoundDm] = useState(true)
  const [soundCall, setSoundCall] = useState(true)
  const [soundVoiceJoin, setSoundVoiceJoin] = useState(true)
  const [desktopNotif, setDesktopNotif] = useState(true)
  const [notifLevel, setNotifLevel] = useState('mentions')

  useEffect(() => {
    if (settings) {
      setQuietEnabled(settings.quiet_hours_enabled ?? false)
      setQuietStart(settings.quiet_hours_start ?? '22:00')
      setQuietEnd(settings.quiet_hours_end ?? '08:00')
      setSoundMessage(settings.sound_message ?? true)
      setSoundMention(settings.sound_mention ?? true)
      setSoundReaction(settings.sound_reaction ?? true)
      setSoundDm(settings.sound_dm ?? true)
      setSoundCall(settings.sound_call ?? true)
      setSoundVoiceJoin(settings.sound_voice_join ?? true)
      setDesktopNotif(settings.desktop_notifications ?? true)
      setNotifLevel(settings.notification_level ?? 'mentions')
    }
  }, [settings])

  return (
    <div className="space-y-6">
      <Field label="Niveau de notification par défaut">
        <Select value={notifLevel} onChange={setNotifLevel} className="w-full"
          options={[
            { value: 'all', label: 'Tous les messages' },
            { value: 'mentions', label: 'Mentions uniquement' },
            { value: 'none', label: 'Aucune notification' },
          ]} />
      </Field>

      <div className="flex items-center justify-between p-3.5 bg-fc-channel rounded-xl border border-fc-hover">
        <div>
          <div className="text-sm font-medium text-white">Notifications bureau</div>
          <div className="text-xs text-fc-muted">Afficher des alertes quand l'onglet n'est pas actif</div>
        </div>
        <Toggle value={desktopNotif} onChange={setDesktopNotif} />
      </div>

      <div>
        <p className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">Sons de notification</p>
        <div className="space-y-0.5">
          {[
            { label: 'Messages dans les salons', value: soundMessage, set: setSoundMessage },
            { label: 'Mentions & pings', value: soundMention, set: setSoundMention },
            { label: 'Réactions à mes messages', value: soundReaction, set: setSoundReaction },
            { label: 'Messages directs (DM)', value: soundDm, set: setSoundDm },
            { label: 'Appels entrants', value: soundCall, set: setSoundCall },
            { label: 'Join/leave vocal', value: soundVoiceJoin, set: setSoundVoiceJoin },
          ].map(item => (
            <div key={item.label} className="flex items-center justify-between px-4 py-2.5 bg-fc-channel rounded-xl hover:bg-fc-hover/30 transition">
              <span className="text-sm text-white">{item.label}</span>
              <Toggle value={item.value} onChange={item.set} />
            </div>
          ))}
        </div>
      </div>

      <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-white flex items-center gap-2">
              <Moon size={14} /> Heures silencieuses
            </div>
            <div className="text-xs text-fc-muted">Aucune notification pendant cette plage</div>
          </div>
          <Toggle value={quietEnabled} onChange={setQuietEnabled} />
        </div>
        {quietEnabled && (
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-fc-hover">
            <div>
              <label className="text-xs text-fc-muted mb-1 block">Début</label>
              <input type="time" value={quietStart} onChange={e => setQuietStart(e.target.value)}
                className="w-full bg-fc-bg border border-fc-hover rounded-lg px-3 py-2 text-sm text-white" />
            </div>
            <div>
              <label className="text-xs text-fc-muted mb-1 block">Fin</label>
              <input type="time" value={quietEnd} onChange={e => setQuietEnd(e.target.value)}
                className="w-full bg-fc-bg border border-fc-hover rounded-lg px-3 py-2 text-sm text-white" />
            </div>
          </div>
        )}
      </div>

      <button
        onClick={() => save.mutate({
          quiet_hours_enabled: quietEnabled, quiet_hours_start: quietStart, quiet_hours_end: quietEnd,
          sound_message: soundMessage, sound_mention: soundMention, sound_reaction: soundReaction,
          sound_dm: soundDm, sound_call: soundCall, sound_voice_join: soundVoiceJoin,
          desktop_notifications: desktopNotif, notification_level: notifLevel,
        })}
        disabled={save.isPending}
        className="w-full py-2.5 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg font-medium text-sm transition disabled:opacity-50"
      >
        {save.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
      </button>
    </div>
  )
}
