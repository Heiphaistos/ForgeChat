import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${value ? 'bg-fc-accent' : 'bg-fc-hover'}`}
    >
      <span className={`inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-fc-muted uppercase tracking-wide">{label}</label>
      {children}
    </div>
  )
}

export default function AudioSection() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedInput, setSelectedInput] = useState('')
  const [selectedOutput, setSelectedOutput] = useState('')
  const [selectedCamera, setSelectedCamera] = useState('')
  const [inputVolume, setInputVolume] = useState(100)
  const [outputVolume, setOutputVolume] = useState(100)
  const [noiseSuppression, setNoiseSuppression] = useState(true)
  const [echoCancellation, setEchoCancellation] = useState(true)
  const [automaticGainControl, setAutomaticGainControl] = useState(true)
  const [pttMode, setPttMode] = useState(false)
  const [pttKey, setPttKey] = useState('Space')
  const [capturingKey, setCapturingKey] = useState(false)
  const [videoResolution, setVideoResolution] = useState('720p')
  const [videoFps, setVideoFps] = useState('30')
  const [backgroundBlur, setBackgroundBlur] = useState(false)
  const [spatialAudio, setSpatialAudio] = useState(false)

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then(list => {
      setDevices(list)
      setSelectedInput(localStorage.getItem('fc_audio_input') ?? '')
      setSelectedOutput(localStorage.getItem('fc_audio_output') ?? '')
      setSelectedCamera(localStorage.getItem('fc_camera') ?? '')
    })
    const saved = localStorage.getItem('fc_audio_settings')
    if (saved) {
      try {
        const s = JSON.parse(saved)
        setInputVolume(s.inputVolume ?? 100)
        setOutputVolume(s.outputVolume ?? 100)
        setNoiseSuppression(s.noiseSuppression ?? true)
        setEchoCancellation(s.echoCancellation ?? true)
        setAutomaticGainControl(s.automaticGainControl ?? true)
        setPttMode(s.pttMode ?? false)
        setPttKey(s.pttKey ?? 'Space')
        setVideoResolution(s.videoResolution ?? '720p')
        setVideoFps(s.videoFps ?? '30')
        setBackgroundBlur(s.backgroundBlur ?? false)
        setSpatialAudio(s.spatialAudio ?? false)
      } catch { /* ignore malformed */ }
    }
  }, [])

  const saveAudio = () => {
    localStorage.setItem('fc_audio_input', selectedInput)
    localStorage.setItem('fc_audio_output', selectedOutput)
    localStorage.setItem('fc_camera', selectedCamera)
    localStorage.setItem('fc_audio_settings', JSON.stringify({
      inputVolume, outputVolume, noiseSuppression, echoCancellation, automaticGainControl,
      pttMode, pttKey, videoResolution, videoFps, backgroundBlur, spatialAudio,
    }))
    toast.success('Paramètres audio/vidéo sauvegardés')
  }

  const captureKey = () => {
    setCapturingKey(true)
    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      const key = e.code === 'Space' ? 'Space' : e.key
      setPttKey(key)
      setCapturingKey(false)
      window.removeEventListener('keydown', handler)
    }
    window.addEventListener('keydown', handler)
  }

  const inputDevices = devices.filter(d => d.kind === 'audioinput')
  const outputDevices = devices.filter(d => d.kind === 'audiooutput')
  const cameraDevices = devices.filter(d => d.kind === 'videoinput')

  return (
    <div className="space-y-6">
      <h3 className="text-base font-semibold text-white border-b border-fc-hover pb-2">Périphériques</h3>

      <Field label="Microphone (entrée)">
        <select value={selectedInput} onChange={e => setSelectedInput(e.target.value)}
          className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white">
          <option value="">Défaut du système</option>
          {inputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Micro ${d.deviceId.slice(0, 6)}`}</option>)}
        </select>
      </Field>

      <Field label={`Volume d'entrée — ${inputVolume}%`}>
        <input type="range" min={0} max={200} value={inputVolume}
          onChange={e => setInputVolume(Number(e.target.value))}
          className="w-full accent-fc-accent" />
      </Field>

      <Field label="Haut-parleurs (sortie)">
        <select value={selectedOutput} onChange={e => setSelectedOutput(e.target.value)}
          className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white">
          <option value="">Défaut du système</option>
          {outputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Sortie ${d.deviceId.slice(0, 6)}`}</option>)}
        </select>
      </Field>

      <Field label={`Volume de sortie — ${outputVolume}%`}>
        <input type="range" min={0} max={200} value={outputVolume}
          onChange={e => setOutputVolume(Number(e.target.value))}
          className="w-full accent-fc-accent" />
      </Field>

      <h3 className="text-base font-semibold text-white border-b border-fc-hover pb-2 pt-2">Traitement audio</h3>

      {[
        { label: 'Suppression de bruit', desc: 'Filtre le bruit ambiant (ventilateur, clavier...)', value: noiseSuppression, set: setNoiseSuppression },
        { label: "Annulation d'écho", desc: "Supprime l'écho et les retours audio", value: echoCancellation, set: setEchoCancellation },
        { label: 'Contrôle automatique du gain', desc: 'Ajuste automatiquement le volume du micro', value: automaticGainControl, set: setAutomaticGainControl },
        { label: 'Audio spatial', desc: 'Son 3D positionnel (si casque compatible)', value: spatialAudio, set: setSpatialAudio },
      ].map(item => (
        <div key={item.label} className="flex items-center justify-between p-3.5 bg-fc-channel rounded-xl border border-fc-hover">
          <div>
            <div className="text-sm font-medium text-white">{item.label}</div>
            <div className="text-xs text-fc-muted">{item.desc}</div>
          </div>
          <Toggle value={item.value} onChange={item.set} />
        </div>
      ))}

      <h3 className="text-base font-semibold text-white border-b border-fc-hover pb-2 pt-2">Mode de parole</h3>

      <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-white">Push-to-Talk (PTT)</div>
            <div className="text-xs text-fc-muted">Maintenez une touche pour parler</div>
          </div>
          <Toggle value={pttMode} onChange={setPttMode} />
        </div>
        {pttMode && (
          <div className="pt-2 border-t border-fc-hover">
            <div className="flex items-center justify-between">
              <span className="text-sm text-fc-muted">Touche PTT</span>
              <button onClick={captureKey}
                className={`px-3 py-1.5 rounded-lg text-sm font-mono font-medium border transition
                  ${capturingKey
                    ? 'border-fc-accent text-fc-accent bg-fc-accent/10 animate-pulse'
                    : 'border-fc-hover text-white hover:border-fc-accent'}`}>
                {capturingKey ? 'Appuyez sur une touche...' : pttKey}
              </button>
            </div>
          </div>
        )}
      </div>

      <h3 className="text-base font-semibold text-white border-b border-fc-hover pb-2 pt-2">Caméra & Vidéo</h3>

      <Field label="Webcam">
        <select value={selectedCamera} onChange={e => setSelectedCamera(e.target.value)}
          className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white">
          <option value="">Défaut du système</option>
          {cameraDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Caméra ${d.deviceId.slice(0, 6)}`}</option>)}
        </select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Résolution">
          <select value={videoResolution} onChange={e => setVideoResolution(e.target.value)}
            className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white">
            {['480p', '720p', '1080p', '1440p', '4K'].map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Images par seconde">
          <select value={videoFps} onChange={e => setVideoFps(e.target.value)}
            className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white">
            {['15', '24', '30', '60'].map(f => <option key={f} value={f}>{f} fps</option>)}
          </select>
        </Field>
      </div>

      <div className="flex items-center justify-between p-3.5 bg-fc-channel rounded-xl border border-fc-hover">
        <div>
          <div className="text-sm font-medium text-white">Flou d'arrière-plan</div>
          <div className="text-xs text-fc-muted">Floute le fond derrière vous en vidéo</div>
        </div>
        <Toggle value={backgroundBlur} onChange={setBackgroundBlur} />
      </div>

      {devices.length === 0 && (
        <div className="p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/30">
          <p className="text-xs text-yellow-400">Autorisez l'accès au micro/caméra pour voir vos périphériques.</p>
        </div>
      )}

      <button onClick={saveAudio}
        className="w-full py-2.5 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg font-medium text-sm transition">
        Sauvegarder
      </button>
    </div>
  )
}
