import { Wifi, WifiOff } from 'lucide-react'
import { useVoice } from '../../store/voice'
import { useT } from '../../i18n'

// Qualité mesurée par le SFU (perte, gigue, débit) : plus de sondage getStats().
// Le SFU dégrade aussi tout seul (simulcast + dynacast + contrôle de congestion).
// `iconOnly` : panneau vocal du bas à gauche, le libellé passe dans l'infobulle.
export default function CallQualityIndicator({ iconOnly = false }: { iconOnly?: boolean }) {
  const status = useVoice(s => s.mediaStatus)
  const q = useVoice(s => s.mediaQuality)
  const t = useT()
  const view =
    status === 'connecting' ? { icon: <Wifi size={12} />, color: 'text-fc-muted', label: t('voice.q.connecting') }
    : status === 'reconnecting' ? { icon: <WifiOff size={12} />, color: 'text-fc-yellow', label: t('voice.q.reconnecting') }
    : status === 'failed' ? { icon: <WifiOff size={12} />, color: 'text-fc-red', label: t('voice.q.offline') }
    : q === 'excellent' || q === 'good' ? { icon: <Wifi size={12} />, color: 'text-fc-green', label: q === 'excellent' ? t('voice.q.excellent') : t('voice.q.good') }
    : q === 'poor' ? { icon: <Wifi size={12} />, color: 'text-fc-yellow', label: t('voice.q.poor') }
    : q === 'lost' ? { icon: <WifiOff size={12} />, color: 'text-fc-red', label: t('voice.q.lost') }
    : { icon: <Wifi size={12} />, color: 'text-fc-muted', label: '' }
  const title = t('voice.q.title', { q: view.label || t('voice.q.unknown') })
  return (
    <div className={`flex items-center gap-1 text-xs flex-shrink-0 ${view.color}`} title={title} aria-label={iconOnly ? title : undefined} role="status">
      {view.icon}{view.label && !iconOnly && <span>{view.label}</span>}
    </div>
  )
}
