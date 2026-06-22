import { useRef, useState, useCallback } from 'react'
import { Music2, Plus, Trash2, Volume2, X, Upload } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client'
import toast from 'react-hot-toast'
import { useWs } from '../../store/ws'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Sound {
  id: string
  name: string
  url: string
  emoji?: string
  duration?: number
}

interface Props {
  serverId: string
  channelId: string
  onClose: () => void
}

// ─── Constants ────────────────────────────────────────────────────────────────
const VOLUME_KEY = 'forgechat_soundboard_volume'
const MAX_FILE_SIZE = 512 * 1024 // 512 KB
const ALLOWED_FORMATS = ['audio/mpeg', 'audio/wav', 'audio/ogg']
const ALLOWED_EXTS = ['.mp3', '.wav', '.ogg']

// ─── Upload Form ──────────────────────────────────────────────────────────────
function UploadForm({
  serverId,
  onDone,
  onCancel,
}: {
  serverId: string
  onDone: () => void
  onCancel: () => void
}) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState('')

  const mutation = useMutation({
    mutationFn: async () => {
      if (!file || !name.trim()) throw new Error('Nom et fichier requis')
      const form = new FormData()
      form.append('name', name.trim())
      if (emoji.trim()) form.append('emoji', emoji.trim())
      form.append('file', file)
      return api.post(`/servers/${serverId}/soundboard`, form)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['soundboard', serverId] })
      toast.success('Son ajouté !')
      onDone()
    },
    onError: (err: any) => {
      toast.error(err?.message ?? "Erreur lors de l'upload")
    },
  })

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError('')
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > MAX_FILE_SIZE) {
      setFileError('Fichier trop volumineux (max 512 KB)')
      return
    }
    const ext = '.' + f.name.split('.').pop()?.toLowerCase()
    if (!ALLOWED_FORMATS.includes(f.type) && !ALLOWED_EXTS.includes(ext)) {
      setFileError('Format non supporté (mp3, wav, ogg)')
      return
    }
    setFile(f)
    if (!name.trim()) setName(f.name.replace(/\.[^.]+$/, ''))
  }

  return (
    <div className="mt-3 p-3 bg-fc-bg rounded-lg border border-fc-hover space-y-2">
      <p className="text-xs font-semibold text-white">Nouveau son</p>

      <input
        type="text"
        placeholder="Nom du son"
        value={name}
        onChange={e => setName(e.target.value)}
        maxLength={32}
        className="w-full bg-fc-hover text-white text-xs rounded px-2 py-1.5 placeholder:text-fc-muted outline-none border border-transparent focus:border-fc-accent"
      />

      <input
        type="text"
        placeholder="Emoji (optionnel)"
        value={emoji}
        onChange={e => setEmoji(e.target.value)}
        maxLength={2}
        className="w-full bg-fc-hover text-white text-xs rounded px-2 py-1.5 placeholder:text-fc-muted outline-none border border-transparent focus:border-fc-accent"
      />

      <div>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-2 w-full text-xs bg-fc-hover hover:bg-fc-accent/20 text-fc-muted hover:text-white border border-dashed border-fc-hover hover:border-fc-accent rounded px-2 py-2 transition"
        >
          <Upload size={12} />
          {file ? file.name : 'Choisir un fichier (mp3 / wav / ogg, max 512 KB)'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg"
          className="hidden"
          onChange={handleFile}
        />
        {fileError && <p className="text-fc-red text-[10px] mt-1">{fileError}</p>}
      </div>

      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="text-xs text-fc-muted hover:text-white px-2 py-1 rounded hover:bg-fc-hover transition"
        >
          Annuler
        </button>
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !file || !name.trim()}
          className="text-xs bg-fc-accent hover:bg-fc-accent/80 text-white px-3 py-1 rounded transition disabled:opacity-50"
        >
          {mutation.isPending ? 'Upload...' : 'Ajouter'}
        </button>
      </div>
    </div>
  )
}

// ─── Sound Button ─────────────────────────────────────────────────────────────
function SoundButton({
  sound,
  volume,
  channelId,
  serverId,
  onDelete,
}: {
  sound: Sound
  volume: number
  channelId: string
  serverId: string
  onDelete: (id: string) => void
}) {
  const { send } = useWs()
  const [playing, setPlaying] = useState(false)

  const play = useCallback(() => {
    const audio = new Audio(sound.url)
    audio.volume = volume / 100
    audio.play().catch(() => null)
    setPlaying(true)
    audio.onended = () => setPlaying(false)
    send({ type: 'SOUNDBOARD_PLAY', sound_id: sound.id, channel_id: channelId })
  }, [sound.url, sound.id, volume, channelId, send])

  return (
    <div className="relative group">
      <button
        onClick={play}
        className={`w-full flex flex-col items-center justify-center gap-1 p-2 rounded-lg border transition text-center
          ${playing
            ? 'border-fc-accent bg-fc-accent/20 text-white'
            : 'border-fc-hover bg-fc-hover hover:border-fc-accent/50 hover:bg-fc-accent/10 text-fc-muted hover:text-white'}`}
        title={sound.name}
      >
        <span className="text-lg leading-none">
          {sound.emoji || <Music2 size={14} />}
        </span>
        <span className="text-[10px] font-medium truncate w-full">{sound.name}</span>
        {sound.duration != null && (
          <span className="text-[9px] text-fc-muted">{sound.duration.toFixed(1)}s</span>
        )}
      </button>

      <button
        onClick={e => { e.stopPropagation(); onDelete(sound.id) }}
        className="absolute top-1 right-1 p-0.5 rounded bg-fc-red/80 text-white opacity-0 group-hover:opacity-100 transition"
        title="Supprimer"
      >
        <Trash2 size={9} />
      </button>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function Soundboard({ serverId, channelId, onClose }: Props) {
  const qc = useQueryClient()
  const [volume, setVolume] = useState<number>(() => {
    const stored = localStorage.getItem(VOLUME_KEY)
    return stored ? Math.min(100, Math.max(0, parseInt(stored, 10))) : 80
  })
  const [showUpload, setShowUpload] = useState(false)

  const { data: sounds = [], isLoading, isError } = useQuery<Sound[]>({
    queryKey: ['soundboard', serverId],
    queryFn: async () => {
      const res = await api.get(`/servers/${serverId}/soundboard`)
      return res.data
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (soundId: string) =>
      api.delete(`/servers/${serverId}/soundboard/${soundId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['soundboard', serverId] })
      toast.success('Son supprimé')
    },
    onError: () => toast.error('Erreur suppression'),
  })

  const handleVolumeChange = (val: number) => {
    setVolume(val)
    localStorage.setItem(VOLUME_KEY, String(val))
  }

  return (
    <div className="w-72 bg-fc-channel border border-fc-hover rounded-xl p-4 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Music2 size={14} className="text-fc-accent" />
          <span className="text-sm font-semibold text-white">Soundboard</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"
        >
          <X size={14} />
        </button>
      </div>

      {/* Volume slider */}
      <div className="flex items-center gap-2 mb-3">
        <Volume2 size={12} className="text-fc-muted flex-shrink-0" />
        <input
          type="range"
          min={0}
          max={100}
          value={volume}
          onChange={e => handleVolumeChange(Number(e.target.value))}
          className="flex-1 h-1 accent-fc-accent cursor-pointer"
        />
        <span className="text-[10px] text-fc-muted w-8 text-right">{volume}%</span>
      </div>

      {/* Sound grid */}
      <div className="min-h-[80px] max-h-64 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center h-16 text-xs text-fc-muted">
            Chargement...
          </div>
        )}
        {isError && (
          <div className="flex items-center justify-center h-16 text-xs text-fc-red">
            Erreur de chargement
          </div>
        )}
        {!isLoading && !isError && sounds.length === 0 && (
          <div className="flex items-center justify-center h-16 text-xs text-fc-muted">
            Aucun son. Ajoutez-en !
          </div>
        )}
        {!isLoading && sounds.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {sounds.map(sound => (
              <SoundButton
                key={sound.id}
                sound={sound}
                volume={volume}
                channelId={channelId}
                serverId={serverId}
                onDelete={id => deleteMutation.mutate(id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add button / Upload form */}
      {showUpload ? (
        <UploadForm
          serverId={serverId}
          onDone={() => setShowUpload(false)}
          onCancel={() => setShowUpload(false)}
        />
      ) : (
        <button
          onClick={() => setShowUpload(true)}
          className="mt-3 w-full flex items-center justify-center gap-2 text-xs text-fc-muted hover:text-white bg-fc-hover hover:bg-fc-accent/20 border border-dashed border-fc-hover hover:border-fc-accent rounded-lg py-2 transition"
        >
          <Plus size={12} /> Ajouter un son
        </button>
      )}
    </div>
  )
}
