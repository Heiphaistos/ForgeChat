// Choix « Couper les notifications » partagé par les réglages de salon et de
// serveur. Valeurs envoyées au serveur dans `mute_minutes` (0 = jusqu'à
// réactivation) ; `keep` conserve la sourdine en cours, `off` la lève.
import { useT, intlLocale, type Key } from '../../i18n'

export type MuteChoice = 'off' | 'keep' | '15' | '60' | '480' | '1440' | '0'

const DURATIONS: { value: MuteChoice; label: Key }[] = [
  { value: '15', label: 'mute.15' },
  { value: '60', label: 'mute.60' },
  { value: '480', label: 'mute.480' },
  { value: '1440', label: 'mute.1440' },
  { value: '0', label: 'mute.0' },
]

/** Corps de requête et échéance locale (ms epoch, `null` = illimitée) d'un choix. */
export function muteRequest(choice: MuteChoice, currentUntil: number | null) {
  const muted = choice !== 'off'
  const minutes = choice === 'off' || choice === 'keep' ? undefined : Number(choice)
  const until = choice === 'keep' ? currentUntil : minutes ? Date.now() + minutes * 60_000 : null
  return { body: { muted, mute_minutes: minutes }, until }
}

export function MuteSelect({ id, value, onChange, currentUntil, wasMuted }: {
  id: string
  value: MuteChoice
  onChange: (v: MuteChoice) => void
  currentUntil: number | null
  wasMuted: boolean
}) {
  const t = useT()
  return (
    <select
      id={id}
      value={value}
      onChange={e => onChange(e.target.value as MuteChoice)}
      className="w-full bg-fc-channel text-fc-text text-sm rounded px-2 py-1.5 border border-fc-hover"
    >
      <option value="off">{t('mute.off')}</option>
      {wasMuted && (
        <option value="keep">
          {currentUntil ? t('mute.until', { time: new Date(currentUntil).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' }) }) : t('mute.untilReactivated')}
        </option>
      )}
      {DURATIONS.map(d => <option key={d.value} value={d.value}>{t('mute.choice', { d: t(d.label).toLowerCase() })}</option>)}
    </select>
  )
}
