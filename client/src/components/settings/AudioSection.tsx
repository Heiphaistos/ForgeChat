import { useState, useEffect, useCallback } from 'react'
import { Field } from './shared'
import { RefreshCw, Waves, Radio } from 'lucide-react'
import { useVoice } from '../../store/voice'
import { useCallStore } from '../../store/call'
import { NOISE_ENGINES, getNoiseEngine, type NoiseEngine } from '../../lib/audio'
import { useT } from '../../i18n'
import { useSpatial } from '../../store/spatial'
import { setAudioOutput } from '../../lib/voicePlayback'
import {
  MicCheck, InputVolume, PttRelease, VoiceProcessing, OutputSettings, SoundSettings, AudioResetButton,
} from './AvAudioSettings'

export default function AudioSection() {
  const t = useT()
  const spatial = useSpatial(s => s.on)
  const setSpatial = useSpatial(s => s.set)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedInput, setSelectedInput] = useState(localStorage.getItem('fc_audio_input') ?? '')
  const [selectedOutput, setSelectedOutput] = useState(localStorage.getItem('fc_audio_output') ?? '')
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown')
  const [engine, setEngine] = useState<NoiseEngine>(() => getNoiseEngine())
  const setNoiseEngine = useVoice(s => s.setNoiseEngine)
  const setAudioInput = useVoice(s => s.setAudioInput)
  const pttMode = useVoice(s => s.pttMode)
  const setPttMode = useVoice(s => s.setPttMode)

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      setDevices(list)
    } catch {}
  }, [])

  const requestPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach(tr => tr.stop())
      setPermission('granted')
      await refreshDevices()
    } catch {
      setPermission('denied')
    }
  }

  useEffect(() => {
    navigator.permissions
      .query({ name: 'microphone' as PermissionName })
      .then(p => {
        setPermission(p.state === 'granted' ? 'granted' : p.state === 'denied' ? 'denied' : 'unknown')
        if (p.state === 'granted') refreshDevices()
        p.onchange = () => {
          setPermission(p.state === 'granted' ? 'granted' : 'denied')
          if (p.state === 'granted') refreshDevices()
        }
      })
      .catch(() => refreshDevices())
  }, [refreshDevices])

  const handleInputChange = (id: string) => {
    setSelectedInput(id)
    // setAudioInput réacquiert le micro et le pousse aux pairs : avant, changer de
    // micro pendant un appel n'avait aucun effet jusqu'au prochain join, sans rien
    // signaler à l'utilisateur.
    void setAudioInput(id)
    void useCallStore.getState().setAudioInput()
  }

  const handleOutputChange = (id: string) => {
    setSelectedOutput(id)
    setAudioOutput(id)
  }

  const inputDevices = devices.filter(d => d.kind === 'audioinput')
  const outputDevices = devices.filter(d => d.kind === 'audiooutput')

  return (
    <div className="space-y-6">
      {permission !== 'granted' && (
        <div className="p-4 bg-fc-yellow/10 border border-fc-yellow/30 rounded-xl flex items-center justify-between">
          <span className="text-sm text-fc-yellow">
            {permission === 'denied'
              ? t('settings.audio.denied')
              : t('settings.audio.needPermission')}
          </span>
          {permission !== 'denied' && (
            <button
              onClick={requestPermission}
              className="px-3 py-1.5 bg-fc-yellow text-black rounded-lg text-sm font-medium hover:opacity-80"
            >
              {t('settings.audio.allow')}
            </button>
          )}
        </div>
      )}

      <Field label={t('settings.audio.input')}>
        <div className="flex gap-2">
          <select
            value={selectedInput}
            onChange={e => handleInputChange(e.target.value)}
            className="flex-1 bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white"
          >
            <option value="">{t('settings.audio.systemDefault')}</option>
            {inputDevices.map(d => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || t('settings.audio.micN', { id: d.deviceId.slice(0, 6) })}
              </option>
            ))}
          </select>
          <button
            onClick={refreshDevices}
            className="p-2 bg-fc-hover rounded-lg hover:bg-fc-channel text-fc-muted"
            title={t('settings.audio.refresh')}
            aria-label={t('settings.audio.refresh')}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </Field>

      <InputVolume />

      <MicCheck deviceId={selectedInput} />

      {/* Suppression de bruit — plusieurs moteurs, façon Krisp */}
      <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover space-y-3">
        <div className="flex items-center gap-3">
          <Waves size={16} className={engine === 'off' ? 'text-fc-muted' : 'text-fc-accent'} />
          <div>
            <p className="text-sm font-medium text-white">{t('settings.audio.noise')}</p>
            <p className="text-xs text-fc-muted mt-0.5">
              {t('settings.audio.noiseDesc')}
            </p>
          </div>
        </div>
        <div className="space-y-1.5">
          {NOISE_ENGINES.map(opt => (
            <label
              key={opt}
              className={`flex items-start gap-3 p-2.5 rounded-lg cursor-pointer border transition
                ${engine === opt ? 'border-fc-accent bg-fc-accent/10' : 'border-transparent hover:bg-fc-hover/50'}`}
            >
              <input
                type="radio"
                name="noise-engine"
                className="mt-0.5 accent-fc-accent"
                checked={engine === opt}
                onChange={() => { setEngine(opt); void setNoiseEngine(opt) }}
              />
              <span>
                <span className="block text-sm text-white">{t(`settings.audio.engine.${opt}`)}</span>
                <span className="block text-xs text-fc-muted">{t(`settings.audio.engine.${opt}.hint`)}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <VoiceProcessing />

      {/* Mode d'entrée : voix / push-to-talk */}
      <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Radio size={16} className={pttMode ? 'text-fc-accent' : 'text-fc-muted'} />
            <div>
              <p className="text-sm font-medium text-white">Push-to-Talk</p>
              <p className="text-xs text-fc-muted mt-0.5">
                {t('settings.audio.pttDesc')}
              </p>
            </div>
          </div>
          <button
            onClick={() => setPttMode(!pttMode)}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 cursor-pointer
              ${pttMode ? 'bg-fc-accent' : 'bg-fc-hover'}`}
            role="switch"
            aria-checked={pttMode}
            aria-label="Push-to-Talk"
          >
            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform duration-200
              ${pttMode ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
        {pttMode && <PttRelease />}
      </div>

      <Field label={t('settings.audio.output')}>
        <select
          value={selectedOutput}
          onChange={e => handleOutputChange(e.target.value)}
          className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white"
        >
          <option value="">{t('settings.audio.systemDefault')}</option>
          {outputDevices.map(d => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || t('settings.audio.outN', { id: d.deviceId.slice(0, 6) })}
            </option>
          ))}
        </select>
        {'setSinkId' in document.createElement('audio') ? null : (
          <p className="text-xs text-fc-muted mt-1">
            {t('settings.audio.noSink')}
          </p>
        )}
      </Field>

      <OutputSettings />

      <Field label={t('voiceLot.spatial.title')}>
        <label className="flex items-center gap-2 text-sm text-white cursor-pointer">
          <input type="checkbox" checked={spatial} onChange={e => setSpatial(e.target.checked)} className="accent-fc-accent" />
          {t('voiceLot.spatial.toggle')}
        </label>
        <p className="text-xs text-fc-muted mt-1">{t('voiceLot.spatial.hint')}</p>
      </Field>

      <SoundSettings />

      <div className="flex justify-end">
        <AudioResetButton />
      </div>
    </div>
  )
}
