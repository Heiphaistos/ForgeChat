import { useT } from '../../i18n'
import { useVoice } from '../../store/voice'

/**
 * Consentement à l'enregistrement : tout le salon voit qui enregistre, et chacun peut
 * refuser (sa voix est alors retirée du mixage de ceux qui enregistrent).
 */
export default function RecordingBanner() {
  const t = useT()
  const recording = useVoice(s => s.recording)
  const peers = useVoice(s => s.peers)
  const noRecord = useVoice(s => s.noRecord)
  const setNoRecord = useVoice(s => s.setNoRecord)
  const recorders = peers.filter(p => p.recording).map(p => p.username)
  if (!recording && !recorders.length) return null
  const names = [...(recording ? [t('voice.you')] : []), ...recorders].join(', ')
  const refused = peers.filter(p => p.noRecord).length
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 px-3 py-1.5 bg-red-600/90 text-white text-xs">
      <span className="font-semibold animate-pulse">● REC</span>
      <span className="flex-1 min-w-0">{t('voiceLot.rec.banner', { names })}</span>
      {recording && refused > 0 && <span className="opacity-90">{t('voiceLot.rec.refusedCount', { n: refused })}</span>}
      {recorders.length > 0 && (
        <button onClick={() => setNoRecord(!noRecord)}
          className="px-2 py-0.5 rounded bg-white/20 hover:bg-white/30 font-medium">
          {noRecord ? t('voiceLot.rec.allow') : t('voiceLot.rec.refuse')}
        </button>
      )}
    </div>
  )
}
