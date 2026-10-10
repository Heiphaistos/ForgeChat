import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Moon, Bell, BellOff, Volume2, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Toggle } from './shared'
import api from '../../api/client'
import toast from 'react-hot-toast'
import { useT } from '../../i18n'
import { useAudioNotifications } from '../../hooks/useAudioNotifications'
import { enableWebPush, disableWebPush, isWebPushActive, webPushSupported } from '../../utils/webPush'

// Web Push : alertes (mentions, MP, appels) même onglet fermé. Le serveur ne
// pousse que si aucune session n'est ouverte et selon les réglages de sourdine.
function WebPushBlock() {
  const t = useT()
  const [active, setActive] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { isWebPushActive().then(setActive) }, [])
  if (!webPushSupported()) return null

  const toggle = async () => {
    setBusy(true)
    try {
      if (active) {
        await disableWebPush()
        setActive(false)
        toast.success(t('settings.notif.pushOff'))
      } else {
        const r = await enableWebPush()
        if (r === 'ok') { setActive(true); toast.success(t('settings.notif.pushOn')) }
        else if (r === 'denied') toast.error(t('settings.notif.denied'))
        else if (r === 'disabled') toast.error(t('settings.notif.pushDisabled'))
        else toast.error(t('settings.notif.pushUnavailable'))
      }
    } catch {
      toast.error(t('settings.notif.pushError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 pt-2 border-t border-fc-hover">
      <div>
        <div className="text-sm text-white">{t('settings.notif.push')}</div>
        <div className="text-xs text-fc-muted">{t('settings.notif.pushDesc')}</div>
      </div>
      <Toggle value={active} onChange={() => { if (!busy) toggle() }} />
    </div>
  )
}

function DesktopNotifBlock() {
  const t = useT()
  const [perm, setPerm] = useState<NotificationPermission>(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  )
  const supported = typeof Notification !== 'undefined'

  const request = async () => {
    if (!supported) return
    const result = await Notification.requestPermission()
    setPerm(result)
    if (result === 'granted') toast.success(t('settings.notif.desktopOn'))
    else if (result === 'denied') toast.error(t('settings.notif.denied'))
  }

  const test = () => {
    if (perm !== 'granted') return
    new Notification('ForgeChat', { body: t('settings.notif.testBody'), icon: '/icon.svg' })
  }

  return (
    <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-white">
        {perm === 'granted' ? <Bell size={14} className="text-fc-green" /> : <BellOff size={14} className="text-fc-muted" />}
        {t('settings.notif.desktop')}
      </div>
      {!supported && <p className="text-xs text-fc-muted">{t('settings.notif.unsupported')}</p>}
      {supported && perm === 'granted' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-fc-green">{t('settings.notif.enabled')}</span>
          <button onClick={test} className="text-xs text-fc-muted underline hover:text-white">{t('settings.audio.test')}</button>
        </div>
      )}
      {supported && perm === 'default' && (
        <button onClick={request} className="w-full py-2 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg text-sm font-medium transition">
          {t('settings.notif.enableDesktop')}
        </button>
      )}
      {supported && perm === 'denied' && (
        <p className="text-xs text-fc-muted">{t('settings.notif.deniedHelp')}</p>
      )}
      <WebPushBlock />
    </div>
  )
}

export default function NotificationsSection() {
  const t = useT()
  const nav = useNavigate()
  const { enabled: audioEnabled, setEnabled: setAudioEnabled, playMention } = useAudioNotifications()

  const { data: settings, refetch } = useQuery({
    queryKey: ['user-settings'],
    queryFn: () => api.get('/user/settings').then(r => r.data),
    staleTime: 60_000,
  })

  const save = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.put('/user/settings', data),
    onSuccess: () => { toast.success(t('common.saved')); refetch() },
  })

  const [quietEnabled, setQuietEnabled] = useState(false)
  const [quietStart, setQuietStart] = useState('22:00')
  const [quietEnd, setQuietEnd] = useState('08:00')

  useEffect(() => {
    if (settings) {
      setQuietEnabled(settings.quiet_hours_enabled ?? false)
      setQuietStart(settings.quiet_hours_start ?? '22:00')
      setQuietEnd(settings.quiet_hours_end ?? '08:00')
    }
  }, [settings])

  return (
    <div className="space-y-6">
      <button
        onClick={() => nav('/notifications')}
        className="w-full flex items-center justify-between gap-3 p-4 bg-fc-channel hover:bg-fc-hover rounded-xl border border-fc-hover text-left transition"
      >
        <span>
          <span className="block text-sm font-medium text-white">{t('notifCenter.open')}</span>
          <span className="block text-xs text-fc-muted mt-0.5">{t('notifCenter.openDesc')}</span>
        </span>
        <ChevronRight size={16} className="text-fc-muted flex-shrink-0" aria-hidden />
      </button>

      <DesktopNotifBlock />

      {/* Sons de notification */}
      <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Volume2 size={16} className={audioEnabled ? 'text-fc-accent' : 'text-fc-muted'} />
            <div>
              <p className="text-sm font-medium text-white">{t('settings.notif.sounds')}</p>
              <p className="text-xs text-fc-muted mt-0.5">{t('settings.notif.soundsDesc')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {audioEnabled && (
              <button
                onClick={playMention}
                className="text-xs text-fc-muted hover:text-white underline"
              >
                {t('settings.audio.test')}
              </button>
            )}
            <Toggle value={audioEnabled} onChange={setAudioEnabled} />
          </div>
        </div>
      </div>
      <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-white flex items-center gap-2"><Moon size={14} /> {t('settings.notif.quiet')}</div>
            <div className="text-xs text-fc-muted">{t('settings.notif.quietDesc')}</div>
          </div>
          <Toggle value={quietEnabled} onChange={setQuietEnabled} />
        </div>

        {quietEnabled && (
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-fc-hover">
            <div>
              <label className="text-xs text-fc-muted mb-1 block">{t('settings.notif.start')}</label>
              <input type="time" value={quietStart} onChange={e => setQuietStart(e.target.value)}
                className="w-full bg-fc-bg border border-fc-hover rounded-lg px-3 py-2 text-sm text-white" />
            </div>
            <div>
              <label className="text-xs text-fc-muted mb-1 block">{t('settings.notif.end')}</label>
              <input type="time" value={quietEnd} onChange={e => setQuietEnd(e.target.value)}
                className="w-full bg-fc-bg border border-fc-hover rounded-lg px-3 py-2 text-sm text-white" />
            </div>
          </div>
        )}
      </div>

      <button
        onClick={() => save.mutate({ quiet_hours_enabled: quietEnabled, quiet_hours_start: quietStart, quiet_hours_end: quietEnd })}
        disabled={save.isPending}
        className="w-full py-2.5 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg font-medium text-sm transition disabled:opacity-50"
      >
        {save.isPending ? t('common.saving') : t('common.save')}
      </button>
    </div>
  )
}
