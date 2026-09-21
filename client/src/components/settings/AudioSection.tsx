import { useState, useEffect, useRef, useCallback } from 'react'
import { Field } from './shared'
import { Mic, RefreshCw, Waves, Radio } from 'lucide-react'
import { useVoice } from '../../store/voice'
import { NOISE_ENGINES, getNoiseEngine, type NoiseEngine } from '../../lib/audio'

export default function AudioSection() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedInput, setSelectedInput] = useState(localStorage.getItem('fc_audio_input') ?? '')
  const [selectedOutput, setSelectedOutput] = useState(localStorage.getItem('fc_audio_output') ?? '')
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown')
  const [vuLevel, setVuLevel] = useState(0)
  const [engine, setEngine] = useState<NoiseEngine>(() => getNoiseEngine())
  const testStreamRef = useRef<MediaStream | null>(null)
  const animFrameRef = useRef<number>(0)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const testCtxRef = useRef<AudioContext | null>(null)
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
      stream.getTracks().forEach(t => t.stop())
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

  const startMicTest = async () => {
    if (testStreamRef.current) return
    try {
      const constraints: MediaStreamConstraints = {
        audio: selectedInput ? { deviceId: { exact: selectedInput } } : true,
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      testStreamRef.current = stream
      const ctx = new AudioContext()
      testCtxRef.current = ctx
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      src.connect(analyser)
      analyserRef.current = analyser

      const buf = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteFrequencyData(buf)
        const avg = buf.reduce((a, b) => a + b, 0) / buf.length
        setVuLevel(Math.min(100, (avg / 128) * 100))
        animFrameRef.current = requestAnimationFrame(tick)
      }
      tick()
    } catch {}
  }

  const stopMicTest = () => {
    cancelAnimationFrame(animFrameRef.current)
    testStreamRef.current?.getTracks().forEach(t => t.stop())
    testStreamRef.current = null
    analyserRef.current = null
    testCtxRef.current?.close()
    testCtxRef.current = null
    setVuLevel(0)
  }

  useEffect(() => () => stopMicTest(), [])

  const handleInputChange = (id: string) => {
    setSelectedInput(id)
    // setAudioInput réacquiert le micro et le pousse aux pairs : avant, changer de
    // micro pendant un appel n'avait aucun effet jusqu'au prochain join, sans rien
    // signaler à l'utilisateur.
    void setAudioInput(id)
    if (testStreamRef.current) {
      stopMicTest()
      setTimeout(startMicTest, 100)
    }
  }

  const handleOutputChange = (id: string) => {
    setSelectedOutput(id)
    localStorage.setItem('fc_audio_output', id)
    // Ne rediriger QUE les éléments d'appel : ce balayage touchait aussi les
    // lecteurs de pièces jointes et les vidéos des messages affichés.
    document.querySelectorAll('audio[data-fc-call], video[data-fc-call]').forEach(el => {
      if ('setSinkId' in el) (el as any).setSinkId(id).catch(() => {})
    })
  }

  const inputDevices = devices.filter(d => d.kind === 'audioinput')
  const outputDevices = devices.filter(d => d.kind === 'audiooutput')

  return (
    <div className="space-y-6">
      {permission !== 'granted' && (
        <div className="p-4 bg-fc-yellow/10 border border-fc-yellow/30 rounded-xl flex items-center justify-between">
          <span className="text-sm text-fc-yellow">
            {permission === 'denied'
              ? 'Accès micro refusé. Autorisez dans les paramètres du navigateur.'
              : 'Autorisation micro requise pour voir les périphériques.'}
          </span>
          {permission !== 'denied' && (
            <button
              onClick={requestPermission}
              className="px-3 py-1.5 bg-fc-yellow text-black rounded-lg text-sm font-medium hover:opacity-80"
            >
              Autoriser
            </button>
          )}
        </div>
      )}

      <Field label="Périphérique d'entrée (Microphone)">
        <div className="flex gap-2">
          <select
            value={selectedInput}
            onChange={e => handleInputChange(e.target.value)}
            className="flex-1 bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white"
          >
            <option value="">Défaut du système</option>
            {inputDevices.map(d => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Micro ${d.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
          <button
            onClick={refreshDevices}
            className="p-2 bg-fc-hover rounded-lg hover:bg-fc-channel text-fc-muted"
            title="Actualiser"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </Field>

      <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-white font-medium uppercase tracking-wide">Test microphone</p>
          <button
            onClick={testStreamRef.current ? stopMicTest : startMicTest}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition
              ${testStreamRef.current
                ? 'bg-fc-red/20 text-fc-red hover:bg-fc-red/30'
                : 'bg-fc-accent/20 text-fc-accent hover:bg-fc-accent/30'
              }`}
          >
            <Mic size={12} />
            {testStreamRef.current ? 'Arrêter' : 'Tester'}
          </button>
        </div>
        <div className="h-3 bg-fc-hover rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-fc-green to-fc-yellow transition-all duration-75 rounded-full"
            style={{ width: `${vuLevel}%` }}
          />
        </div>
        {vuLevel === 0 && testStreamRef.current && (
          <p className="text-xs text-fc-muted">Parlez pour voir le niveau...</p>
        )}
      </div>

      {/* Suppression de bruit — plusieurs moteurs, façon Krisp */}
      <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover space-y-3">
        <div className="flex items-center gap-3">
          <Waves size={16} className={engine === 'off' ? 'text-fc-muted' : 'text-fc-accent'} />
          <div>
            <p className="text-sm font-medium text-white">Suppression de bruit</p>
            <p className="text-xs text-fc-muted mt-0.5">
              Filtre le bruit de fond (ventilateur, clavier, ambiance). Appliqué immédiatement, même en pleine conversation.
            </p>
          </div>
        </div>
        <div className="space-y-1.5">
          {NOISE_ENGINES.map(opt => (
            <label
              key={opt.id}
              className={`flex items-start gap-3 p-2.5 rounded-lg cursor-pointer border transition
                ${engine === opt.id ? 'border-fc-accent bg-fc-accent/10' : 'border-transparent hover:bg-fc-hover/50'}`}
            >
              <input
                type="radio"
                name="noise-engine"
                className="mt-0.5 accent-fc-accent"
                checked={engine === opt.id}
                onChange={() => { setEngine(opt.id); void setNoiseEngine(opt.id) }}
              />
              <span>
                <span className="block text-sm text-white">{opt.label}</span>
                <span className="block text-xs text-fc-muted">{opt.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Mode d'entrée : voix / push-to-talk */}
      <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Radio size={16} className={pttMode ? 'text-fc-accent' : 'text-fc-muted'} />
            <div>
              <p className="text-sm font-medium text-white">Push-to-Talk</p>
              <p className="text-xs text-fc-muted mt-0.5">
                Le micro ne s'ouvre que pendant l'appui sur le raccourci (Réglages &gt; Raccourcis clavier).
                Sur l'application bureau, il fonctionne même quand ForgeChat n'a pas le focus.
              </p>
            </div>
          </div>
          <button
            onClick={() => setPttMode(!pttMode)}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 cursor-pointer
              ${pttMode ? 'bg-fc-accent' : 'bg-fc-hover'}`}
            role="switch"
            aria-checked={pttMode}
          >
            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform duration-200
              ${pttMode ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
      </div>

      <Field label="Périphérique de sortie (Haut-parleurs)">
        <select
          value={selectedOutput}
          onChange={e => handleOutputChange(e.target.value)}
          className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white"
        >
          <option value="">Défaut du système</option>
          {outputDevices.map(d => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Sortie ${d.deviceId.slice(0, 6)}`}
            </option>
          ))}
        </select>
        {'setSinkId' in document.createElement('audio') ? null : (
          <p className="text-xs text-fc-muted mt-1">
            Votre navigateur ne supporte pas la sélection de sortie audio.
          </p>
        )}
      </Field>
    </div>
  )
}
