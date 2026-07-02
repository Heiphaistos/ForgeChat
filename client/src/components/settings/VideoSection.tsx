import { useState, useEffect, useRef, useCallback } from 'react'
import { Field } from './shared'
import { Camera, RefreshCw, ShieldCheck, ShieldX } from 'lucide-react'

export default function VideoSection() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedCamera, setSelectedCamera] = useState(localStorage.getItem('fc_video_input') ?? '')
  const [previewActive, setPreviewActive] = useState(false)
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown')
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      setDevices(list.filter(d => d.kind === 'videoinput'))
    } catch {}
  }, [])

  useEffect(() => {
    navigator.permissions
      .query({ name: 'camera' as PermissionName })
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

  const requestPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      stream.getTracks().forEach(t => t.stop())
      setPermission('granted')
      await refreshDevices()
    } catch {
      setPermission('denied')
    }
  }

  const startPreview = async () => {
    try {
      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          ...(selectedCamera ? { deviceId: { exact: selectedCamera } } : {}),
        },
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
      setPreviewActive(true)
      setPermission('granted')
      await refreshDevices()
    } catch {
      setPermission('denied')
    }
  }

  const stopPreview = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setPreviewActive(false)
  }

  useEffect(() => () => stopPreview(), [])

  const handleCameraChange = (id: string) => {
    setSelectedCamera(id)
    localStorage.setItem('fc_video_input', id)
    if (previewActive) {
      stopPreview()
      setTimeout(startPreview, 100)
    }
  }

  return (
    <div className="space-y-6">
      {/* Bloc permission caméra */}
      {permission !== 'granted' && (
        <div className={`p-4 rounded-xl border flex items-center gap-3
          ${permission === 'denied'
            ? 'bg-fc-red/10 border-fc-red/30'
            : 'bg-fc-accent/10 border-fc-accent/30'}`}
        >
          {permission === 'denied'
            ? <ShieldX size={20} className="text-fc-red flex-shrink-0" />
            : <ShieldCheck size={20} className="text-fc-accent flex-shrink-0" />}
          <div className="flex-1">
            <p className="text-sm font-medium text-white">
              {permission === 'denied' ? 'Accès caméra refusé' : 'Accès caméra requis'}
            </p>
            <p className="text-xs text-fc-muted mt-0.5">
              {permission === 'denied'
                ? 'Autorisez la caméra dans les paramètres de votre navigateur.'
                : 'Cliquez pour autoriser ForgeChat à accéder à votre caméra.'}
            </p>
          </div>
          {permission !== 'denied' && (
            <button onClick={requestPermission} className="btn-primary text-xs px-3 py-1.5 flex-shrink-0">
              Autoriser
            </button>
          )}
        </div>
      )}

      <Field label="Caméra">
        <div className="flex gap-2">
          <select
            value={selectedCamera}
            onChange={e => handleCameraChange(e.target.value)}
            className="flex-1 bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white"
          >
            <option value="">Défaut du système</option>
            {devices.map(d => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Caméra ${d.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
          <button
            onClick={refreshDevices}
            className="p-2 bg-fc-hover rounded-lg hover:bg-fc-channel text-fc-muted"
            title="Actualiser la liste"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </Field>

      <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-white font-medium uppercase tracking-wide">Aperçu caméra</p>
          <button
            onClick={previewActive ? stopPreview : startPreview}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition
              ${previewActive
                ? 'bg-fc-red/20 text-fc-red hover:bg-fc-red/30'
                : 'bg-fc-accent/20 text-fc-accent hover:bg-fc-accent/30'
              }`}
          >
            <Camera size={12} />
            {previewActive ? 'Arrêter' : 'Aperçu'}
          </button>
        </div>
        <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
          {previewActive ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-fc-muted">
              <Camera size={32} className="opacity-30" />
              <span className="text-xs">Cliquez sur Aperçu pour tester votre caméra</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
