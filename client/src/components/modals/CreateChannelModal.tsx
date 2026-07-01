import { useState } from 'react'
import { Hash, Volume2, X, Video, Megaphone, MessagesSquare, Radio, ChevronDown, Settings } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client'
import toast from 'react-hot-toast'

type ChannelType = 'text' | 'voice' | 'video' | 'announcement' | 'forum' | 'stage'

const CHANNEL_TYPES: { value: ChannelType; icon: any; label: string; desc: string; color: string }[] = [
  { value: 'text',         icon: Hash,           label: 'Texte',       desc: 'Messages, images, GIFs, embeds...',           color: 'text-fc-muted' },
  { value: 'announcement', icon: Megaphone,       label: 'Annonces',    desc: 'Partagez des nouvelles importantes.',          color: 'text-yellow-400' },
  { value: 'forum',        icon: MessagesSquare,  label: 'Forum',       desc: 'Posts organisés avec tags et réponses.',       color: 'text-green-400' },
  { value: 'voice',        icon: Volume2,         label: 'Vocal',       desc: 'Chat vocal avec des membres.',                 color: 'text-blue-400' },
  { value: 'video',        icon: Video,           label: 'Vidéo',       desc: 'Appels vidéo et partage d\'écran.',            color: 'text-purple-400' },
  { value: 'stage',        icon: Radio,           label: 'Scène',       desc: 'Événements audio (speaker + audience).',       color: 'text-pink-400' },
]

const SLOWMODE_OPTIONS = [
  { label: 'Désactivé', value: 0 },
  { label: '5 secondes', value: 5 },
  { label: '10 secondes', value: 10 },
  { label: '30 secondes', value: 30 },
  { label: '1 minute', value: 60 },
  { label: '5 minutes', value: 300 },
  { label: '1 heure', value: 3600 },
]

interface Props {
  serverId: string
  onClose: () => void
  defaultCategoryId?: string | null
}

export default function CreateChannelModal({ serverId, onClose, defaultCategoryId }: Props) {
  const [name, setName] = useState('')
  const [type, setType] = useState<ChannelType>('text')
  const [topic, setTopic] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(defaultCategoryId ?? null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [isNsfw, setIsNsfw] = useState(false)
  const [slowmode, setSlowmode] = useState(0)
  const [userLimit, setUserLimit] = useState(0)
  const [isPrivate, setIsPrivate] = useState(false)
  const qc = useQueryClient()

  // Récupérer les catégories pour le sélecteur
  const { data: serverData } = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => api.get(`/servers/${serverId}`).then(r => r.data),
  })
  const categories: any[] = (serverData?.channels ?? []).filter((c: any) => c.type === 'category')

  const create = useMutation({
    mutationFn: () => api.post(`/servers/${serverId}/channels`, {
      name: name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, ''),
      type,
      topic: topic.trim() || undefined,
      category_id: categoryId || undefined,
      is_nsfw: isNsfw || undefined,
      slowmode_delay: slowmode > 0 ? slowmode : undefined,
      user_limit: userLimit > 0 ? userLimit : undefined,
      is_private: isPrivate || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['server', serverId] })
      toast.success(`Canal #${name} créé !`)
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const selectedType = CHANNEL_TYPES.find(t => t.value === type)!
  const isVoiceType = ['voice', 'video', 'stage'].includes(type)
  const isTextType = ['text', 'announcement', 'forum'].includes(type)

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-3 md:px-0" onClick={onClose}>
      <div className="bg-fc-channel rounded-xl w-full max-w-[520px] max-h-[90dvh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-6 border-b border-fc-bg">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold text-white">Créer un canal</h2>
              {categoryId && categories.find(c => c.id === categoryId) && (
                <p className="text-fc-muted text-xs mt-0.5">
                  Dans : <span className="text-white">{categories.find(c => c.id === categoryId)?.name}</span>
                </p>
              )}
            </div>
            <button onClick={onClose} className="text-fc-muted hover:text-white transition p-1 rounded hover:bg-fc-hover">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Types */}
          <div>
            <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">Type de canal</label>
            <div className="grid grid-cols-2 gap-2">
              {CHANNEL_TYPES.map(({ value, icon: Icon, label, desc, color }) => (
                <button key={value} onClick={() => setType(value)}
                  className={`flex items-start gap-3 p-3 rounded-xl border transition text-left
                    ${type === value ? 'border-fc-accent bg-fc-accent/10' : 'border-fc-hover bg-fc-hover/20 hover:bg-fc-hover/40'}`}>
                  <Icon size={18} className={`mt-0.5 flex-shrink-0 ${type === value ? 'text-fc-accent' : color}`} />
                  <div>
                    <div className={`font-medium text-sm ${type === value ? 'text-white' : 'text-fc-text'}`}>{label}</div>
                    <div className="text-xs text-fc-muted leading-snug mt-0.5">{desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Nom */}
          <div>
            <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">Nom du canal</label>
            <div className="relative">
              <span className={`absolute left-3 top-1/2 -translate-y-1/2 ${selectedType.color}`}>
                <selectedType.icon size={16} />
              </span>
              <input autoFocus value={name}
                onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-_\s]/g, ''))}
                onBlur={e => setName(e.target.value.replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''))}
                placeholder="nouveau-canal"
                maxLength={100}
                className="w-full pl-8 pr-3 py-2 bg-fc-input rounded-lg text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
              />
            </div>
          </div>

          {/* Topic / description */}
          {isTextType && (
            <div>
              <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">
                {type === 'forum' ? 'Description du forum' : 'Description (optionnel)'}
              </label>
              <input value={topic} onChange={e => setTopic(e.target.value)}
                placeholder={type === 'forum' ? 'À quoi sert ce forum ?' : 'Description du canal...'}
                maxLength={1024}
                className="w-full px-3 py-2 bg-fc-input rounded-lg text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
              />
            </div>
          )}

          {/* Catégorie parente */}
          {categories.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">Catégorie</label>
              <select value={categoryId ?? ''} onChange={e => setCategoryId(e.target.value || null)}
                className="w-full px-3 py-2 bg-fc-input rounded-lg text-white outline-none text-sm">
                <option value="">Aucune catégorie</option>
                {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          {/* Canal privé */}
          <div className="flex items-center justify-between p-3 bg-fc-bg/50 rounded-xl border border-fc-hover">
            <div>
              <div className="text-sm font-medium text-white flex items-center gap-1.5">🔒 Canal privé</div>
              <div className="text-xs text-fc-muted">Seuls les membres avec les permissions appropriées y auront accès</div>
            </div>
            <button onClick={() => setIsPrivate(v => !v)}
              className={`relative w-11 h-6 rounded-full transition flex-shrink-0 ${isPrivate ? 'bg-fc-accent' : 'bg-fc-hover'}`}>
              <span className={`absolute top-[3px] w-[18px] h-[18px] bg-white rounded-full transition-all shadow ${isPrivate ? 'left-[23px]' : 'left-[3px]'}`} />
            </button>
          </div>

          {/* Options avancées */}
          <button onClick={() => setShowAdvanced(v => !v)}
            className="flex items-center gap-1.5 text-sm text-fc-muted hover:text-white transition">
            <Settings size={14} />
            Options avancées
            <ChevronDown size={14} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
          </button>

          {showAdvanced && (
            <div className="space-y-4 p-4 bg-fc-bg/50 rounded-xl border border-fc-hover">
              {/* NSFW */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-white">Canal NSFW</div>
                  <div className="text-xs text-fc-muted">Contenu adulte</div>
                </div>
                <button onClick={() => setIsNsfw(v => !v)}
                  className={`relative w-9 h-5 rounded-full transition ${isNsfw ? 'bg-fc-accent' : 'bg-fc-hover'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all shadow ${isNsfw ? 'left-4' : 'left-0.5'}`} />
                </button>
              </div>

              {/* Slowmode (texte seulement) */}
              {isTextType && (
                <div>
                  <label className="block text-xs text-fc-muted mb-1">Mode lent</label>
                  <select value={slowmode} onChange={e => setSlowmode(Number(e.target.value))}
                    className="w-full px-3 py-1.5 bg-fc-input rounded-lg text-white outline-none text-sm">
                    {SLOWMODE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              )}

              {/* User limit (vocal) */}
              {isVoiceType && (
                <div>
                  <div className="flex justify-between text-xs text-fc-muted mb-1">
                    <span>Limite d'utilisateurs</span>
                    <span className="text-white font-medium">{userLimit === 0 ? 'Illimité' : userLimit}</span>
                  </div>
                  <input type="range" min={0} max={99} value={userLimit}
                    onChange={e => setUserLimit(Number(e.target.value))}
                    className="w-full accent-fc-accent" />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-fc-muted hover:text-white transition text-sm">Annuler</button>
          <button onClick={() => name.trim() && create.mutate()}
            disabled={!name.trim() || create.isPending}
            className="px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition disabled:opacity-50">
            {create.isPending ? 'Création...' : 'Créer le canal'}
          </button>
        </div>
      </div>
    </div>
  )
}
