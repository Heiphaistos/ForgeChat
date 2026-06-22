import { useState, useEffect } from 'react'
import { Field } from './shared'

export default function AudioSection() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedInput, setSelectedInput] = useState('')
  const [selectedOutput, setSelectedOutput] = useState('')

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then(list => {
      setDevices(list)
      const saved_in = localStorage.getItem('fc_audio_input') ?? ''
      const saved_out = localStorage.getItem('fc_audio_output') ?? ''
      setSelectedInput(saved_in)
      setSelectedOutput(saved_out)
    })
  }, [])

  const inputDevices = devices.filter(d => d.kind === 'audioinput')
  const outputDevices = devices.filter(d => d.kind === 'audiooutput')

  const handleInputChange = (id: string) => {
    setSelectedInput(id)
    localStorage.setItem('fc_audio_input', id)
  }

  const handleOutputChange = (id: string) => {
    setSelectedOutput(id)
    localStorage.setItem('fc_audio_output', id)
  }

  return (
    <div className="space-y-6">
      <Field label="Périphérique d'entrée (Microphone)">
        <select
          value={selectedInput}
          onChange={e => handleInputChange(e.target.value)}
          className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white"
        >
          <option value="">Défaut du système</option>
          {inputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Micro ${d.deviceId.slice(0, 6)}`}</option>)}
        </select>
      </Field>

      <Field label="Périphérique de sortie (Haut-parleurs)">
        <select
          value={selectedOutput}
          onChange={e => handleOutputChange(e.target.value)}
          className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white"
        >
          <option value="">Défaut du système</option>
          {outputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Sortie ${d.deviceId.slice(0, 6)}`}</option>)}
        </select>
      </Field>

      <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover space-y-1 text-sm text-fc-muted">
        <p className="text-white font-medium text-xs uppercase tracking-wide mb-2">Test micro</p>
        <p>Rejoignez un canal vocal pour tester votre microphone en temps réel.</p>
        {devices.length === 0 && <p className="text-xs text-fc-yellow">Autorisez l'accès au micro pour voir vos périphériques.</p>}
      </div>
    </div>
  )
}
