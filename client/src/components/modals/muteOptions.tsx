// Choix « Couper les notifications » partagé par les réglages de salon et de
// serveur. Valeurs envoyées au serveur dans `mute_minutes` (0 = jusqu'à
// réactivation) ; `keep` conserve la sourdine en cours, `off` la lève.
export type MuteChoice = 'off' | 'keep' | '15' | '60' | '480' | '1440' | '0'

const DURATIONS: { value: MuteChoice; label: string }[] = [
  { value: '15', label: 'Pendant 15 minutes' },
  { value: '60', label: 'Pendant 1 heure' },
  { value: '480', label: 'Pendant 8 heures' },
  { value: '1440', label: 'Pendant 24 heures' },
  { value: '0', label: "Jusqu'à réactivation" },
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
  return (
    <select
      id={id}
      value={value}
      onChange={e => onChange(e.target.value as MuteChoice)}
      className="w-full bg-fc-channel text-fc-text text-sm rounded px-2 py-1.5 border border-fc-hover"
    >
      <option value="off">Notifications actives</option>
      {wasMuted && (
        <option value="keep">
          {currentUntil ? `Coupé jusqu'à ${new Date(currentUntil).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : "Coupé jusqu'à réactivation"}
        </option>
      )}
      {DURATIONS.map(d => <option key={d.value} value={d.value}>{`Couper ${d.label.toLowerCase()}`}</option>)}
    </select>
  )
}
