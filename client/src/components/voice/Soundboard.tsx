import { useRef, useState, useCallback } from 'react'
import { Music2, Plus, Trash2, Volume2, X, Upload, LogIn } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api, { mediaUrl } from '../../api/client'
import toast from 'react-hot-toast'
import { useWs } from '../../store/ws'
import { useT } from '../../i18n'
import { setJoinSound, useJoinSound } from '../../lib/joinSound'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Sound {
  id: string
  name: string
  file_url: string
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
const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2 Mo (= server/src/handlers/soundboard.rs)
const ALLOWED_FORMATS = ['audio/mpeg', 'audio/wav', 'audio/ogg']
const ALLOWED_EXTS = ['.mp3', '.wav', '.ogg']

// ─── Upload Form ──────────────────────────────────────────────────────────────
function UploadForm({
  serverId,
  personal,
  onDone,
  onCancel,
}: {
  serverId: string
  /** Son perso (à moi, jouable dans tous mes salons) plutôt que son du serveur. */
  personal: boolean
  onDone: () => void
  onCancel: () => void
}) {
  const t = useT()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState('')

  const mutation = useMutation({
    mutationFn: async () => {
      if (!file || !name.trim()) throw new Error(t('sb.required'))
      const form = new FormData()
      form.append('name', name.trim())
      if (emoji.trim()) form.append('emoji', emoji.trim())
      form.append('file', file)
      return api.post(personal ? '/users/me/sounds' : `/servers/${serverId}/soundboard`, form)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: personal ? ['my_sounds'] : ['soundboard', serverId] })
      toast.success(t('sb.added'))
      onDone()
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error ?? err?.message ?? t('sb.uploadError'))
    },
  })

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError('')
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > MAX_FILE_SIZE) {
      setFileError(t('sb.tooBig'))
      return
    }
    const ext = '.' + f.name.split('.').pop()?.toLowerCase()
    if (!ALLOWED_FORMATS.includes(f.type) && !ALLOWED_EXTS.includes(ext)) {
      setFileError(t('sb.badFormat'))
      return
    }
    setFile(f)
    if (!name.trim()) setName(f.name.replace(/\.[^.]+$/, ''))
  }

  return (
    <div className="mt-3 p-3 bg-fc-bg rounded-lg border border-fc-hover space-y-2">
      <p className="text-xs font-semibold text-white">{personal ? t('voiceLot.sb.newPersonal') : t('sb.new')}</p>

      <input
        type="text"
        placeholder={t('sb.name')}
        aria-label={t('sb.name')}
        value={name}
        onChange={e => setName(e.target.value)}
        maxLength={32}
        className="w-full bg-fc-hover text-white text-xs rounded px-2 py-1.5 placeholder:text-fc-muted outline-none border border-transparent focus:border-fc-accent"
      />

      <input
        type="text"
        placeholder={t('sb.emoji')}
        aria-label={t('sb.emoji')}
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
          {file ? file.name : t('sb.pick')}
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
          {t('common.cancel')}
        </button>
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !file || !name.trim()}
          className="text-xs bg-fc-accent hover:bg-fc-accent/80 text-white px-3 py-1 rounded transition disabled:opacity-50"
        >
          {mutation.isPending ? t('srv.uploading') : t('chset.add')}
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
  /** Absent pour les sons d'un autre serveur (pas supprimables d'ici). */
  onDelete?: (id: string) => void
}) {
  const t = useT()
  const { send } = useWs()
  const [playing, setPlaying] = useState(false)
  const isJoinSound = useJoinSound()?.id === sound.id

  const play = useCallback(() => {
    const audio = new Audio(mediaUrl(sound.file_url))
    audio.volume = volume / 100
    audio.play().catch(() => null)
    setPlaying(true)
    audio.onended = () => setPlaying(false)
    send({ type: 'SOUNDBOARD_PLAY', sound_id: sound.id, channel_id: channelId })
  }, [sound.file_url, sound.id, volume, channelId, send])

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
        onClick={e => { e.stopPropagation(); setJoinSound(isJoinSound ? null : { id: sound.id, name: sound.name, file_url: sound.file_url }) }}
        className={`absolute top-1 left-1 p-0.5 rounded text-[10px] leading-none transition ${isJoinSound ? 'bg-fc-accent text-white opacity-100' : 'bg-black/50 text-white opacity-100 md:opacity-0 md:group-hover:opacity-100'}`}
        title={isJoinSound ? t('voice.joinSound.unset') : t('voice.joinSound.set')}
        aria-label={isJoinSound ? t('voice.joinSound.unset') : t('voice.joinSound.set')}
        aria-pressed={isJoinSound}
      >
        <LogIn size={9} />
      </button>

      {onDelete && (
        <button
          onClick={e => { e.stopPropagation(); onDelete(sound.id) }}
          className="absolute top-1 right-1 p-0.5 rounded bg-fc-red/80 text-white opacity-100 md:opacity-0 md:group-hover:opacity-100 transition"
          title={t('common.delete')}
          aria-label={t('common.delete')}
        >
          <Trash2 size={9} />
        </button>
      )}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function Soundboard({ serverId, channelId, onClose }: Props) {
  const t = useT()
  const qc = useQueryClient()
  const [volume, setVolume] = useState<number>(() => {
    const stored = localStorage.getItem(VOLUME_KEY)
    return stored ? Math.min(100, Math.max(0, parseInt(stored, 10))) : 80
  })
  const [showUpload, setShowUpload] = useState<null | 'server' | 'personal'>(null)

  const { data: sounds = [], isLoading, isError } = useQuery<Sound[]>({
    queryKey: ['soundboard', serverId],
    queryFn: async () => {
      const res = await api.get(`/servers/${serverId}/soundboard`)
      return res.data
    },
  })

  // Sons de mes autres serveurs, jouables ici aussi.
  const { data: mySounds = [] } = useQuery<(Sound & { server_id: string; server_name: string })[]>({
    queryKey: ['my_soundboard'],
    queryFn: () => api.get('/users/me/soundboard').then(r => r.data),
    staleTime: 60_000,
  })
  const autres = mySounds.filter(s => s.server_id !== serverId)
  // Sons perso : à moi, jouables dans tous mes salons vocaux.
  const { data: personal = [] } = useQuery<Sound[]>({
    queryKey: ['my_sounds'],
    queryFn: () => api.get('/users/me/sounds').then(r => r.data),
    staleTime: 60_000,
  })
  const deletePersonal = useMutation({
    mutationFn: (soundId: string) => api.delete(`/users/me/sounds/${soundId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my_sounds'] })
      toast.success(t('sb.deleted'))
    },
    onError: () => toast.error(t('settings.adv.deleteError')),
  })

  const deleteMutation = useMutation({
    mutationFn: (soundId: string) =>
      api.delete(`/servers/${serverId}/soundboard/${soundId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['soundboard', serverId] })
      toast.success(t('sb.deleted'))
    },
    onError: () => toast.error(t('settings.adv.deleteError')),
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
          aria-label={t('sb.close')}
          className="p-1 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"
        >
          <X size={14} aria-hidden />
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
          aria-label={t('sb.volume')}
          className="flex-1 h-1 accent-fc-accent cursor-pointer"
        />
        <span className="text-[10px] text-fc-muted w-8 text-right">{volume}%</span>
      </div>

      {/* Sound grid */}
      <div className="min-h-[80px] max-h-64 overflow-y-auto overscroll-contain">
        {isLoading && (
          <div className="flex items-center justify-center h-16 text-xs text-fc-muted">
            {t('common.loading')}
          </div>
        )}
        {isError && (
          <div className="flex items-center justify-center h-16 text-xs text-fc-red">
            {t('gdm.loadError')}
          </div>
        )}
        {!isLoading && !isError && sounds.length === 0 && (
          <div className="flex items-center justify-center h-16 text-xs text-fc-muted">
            {t('sb.none')}
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
        {personal.length > 0 && (
          <div className="mt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-fc-muted mb-1">{t('voiceLot.sb.mine')}</p>
            <div className="grid grid-cols-2 gap-2">
              {personal.map(sound => (
                <SoundButton key={sound.id} sound={sound} volume={volume} channelId={channelId} serverId={serverId}
                  onDelete={id => deletePersonal.mutate(id)} />
              ))}
            </div>
          </div>
        )}
        {[...new Set(autres.map(s => s.server_id))].map(sid => {
          const liste = autres.filter(s => s.server_id === sid)
          return (
            <div key={sid} className="mt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-fc-muted mb-1">{liste[0].server_name}</p>
              <div className="grid grid-cols-2 gap-2">
                {liste.map(sound => (
                  <SoundButton key={sound.id} sound={sound} volume={volume} channelId={channelId} serverId={serverId} />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Add button / Upload form */}
      {showUpload ? (
        <UploadForm
          serverId={serverId}
          personal={showUpload === 'personal'}
          onDone={() => setShowUpload(null)}
          onCancel={() => setShowUpload(null)}
        />
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(['server', 'personal'] as const).map(kind => (
            <button
              key={kind}
              onClick={() => setShowUpload(kind)}
              className="flex items-center justify-center gap-1 text-xs text-fc-muted hover:text-white bg-fc-hover hover:bg-fc-accent/20 border border-dashed border-fc-hover hover:border-fc-accent rounded-lg py-2 transition"
            >
              <Plus size={12} /> {kind === 'server' ? t('sb.add') : t('voiceLot.sb.addPersonal')}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
