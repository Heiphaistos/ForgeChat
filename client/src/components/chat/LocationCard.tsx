import { MapPin } from 'lucide-react'
import { useT } from '../../i18n'
import { osmUrl, type Geo } from '../../lib/geo'

/** Position partagée (chiffrée de bout en bout) : coordonnées, précision, lien à la demande. */
export default function LocationCard({ g }: { g: Geo }) {
  const t = useT()
  return (
    <div className="mt-1 inline-flex items-start gap-3 rounded-lg border border-fc-hover bg-fc-channel px-3 py-2 max-w-sm">
      <MapPin size={20} className="text-fc-red mt-0.5 flex-shrink-0" aria-hidden />
      <div className="text-sm">
        <div className="text-white font-medium">{t('geo.shared')}</div>
        <div className="text-xs text-fc-muted font-mono">{g.lat.toFixed(5)}, {g.lon.toFixed(5)}{g.acc !== undefined ? ` · ±${g.acc} m` : ''}</div>
        <a href={osmUrl(g)} target="_blank" rel="noopener noreferrer" className="text-xs text-fc-accent">{t('geo.open')}</a>
      </div>
    </div>
  )
}
