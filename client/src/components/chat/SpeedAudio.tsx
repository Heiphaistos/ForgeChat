// Lecteur audio des pièces jointes (vocaux des MP, groupes et salons) avec vitesse de lecture
// de 1× à 3×, la hauteur de la voix étant conservée par le navigateur.
import { useEffect, useRef, useState } from 'react'
import { useT } from '../../i18n'

export const SPEEDS = [1, 1.25, 1.5, 2, 3] as const

export default function SpeedAudio({ src }: { src?: string }) {
  const t = useT()
  const ref = useRef<HTMLAudioElement>(null)
  const [i, setI] = useState(0)
  const rate = SPEEDS[i]
  // Le navigateur remet playbackRate à 1 quand la source change : on le repose à chaque fois.
  useEffect(() => { if (ref.current) ref.current.playbackRate = rate }, [rate, src])
  return (
    <div className="flex items-center gap-2 max-w-full">
      <audio ref={ref} src={src} controls preload="metadata" className="max-w-full min-w-0"
        onLoadedMetadata={e => { e.currentTarget.playbackRate = rate }} />
      <button type="button" onClick={() => { if (ref.current) ref.current.currentTime = Math.max(0, ref.current.currentTime - 5) }}
        title={t('chat.audioBack5')} aria-label={t('chat.audioBack5')}
        className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums bg-fc-accent/10 text-fc-accent hover:bg-fc-accent/20">
        −5 s
      </button>
      <button type="button" onClick={() => setI((i + 1) % SPEEDS.length)}
        title={t('chat.audioSpeed')} aria-label={`${t('chat.audioSpeed')} : ${rate}×`}
        className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums bg-fc-accent/10 text-fc-accent hover:bg-fc-accent/20">
        {rate.toLocaleString()}×
      </button>
    </div>
  )
}
