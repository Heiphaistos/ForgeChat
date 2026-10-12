import { Film } from 'lucide-react'
import { Toggle } from './shared'
import { useT } from '../../i18n'
import { setStreamerMode, useStreamerActive } from '../../lib/streamerMode'
import { StreamerPrefs } from './UxPrefControls'

export default function StreamerSection() {
  const t = useT()
  const active = useStreamerActive()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between p-4 bg-fc-channel rounded-xl border border-fc-hover">
        <div>
          <div className="text-sm font-medium text-white flex items-center gap-2"><Film size={14} /> {t('settings.section.streamer')}</div>
          <div className="text-xs text-fc-muted">{t('settings.streamer.desc')}</div>
          <div className="text-xs text-fc-muted mt-1">{t('ux.streamer.shortcutHint')}</div>
        </div>
        {/* Enregistré sur le compte tout de suite (comme le raccourci). */}
        <Toggle value={active} onChange={v => setStreamerMode(v, true)} label={t('settings.section.streamer')} />
      </div>

      <StreamerPrefs />
    </div>
  )
}
