import { useState, useEffect } from 'react'
import { X, Hash, Volume2, Video, Radio, Megaphone, MessagesSquare, Lock, Shield, Settings, Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client'
import toast from 'react-hot-toast'

const SLOWMODE_OPTIONS = [
  { label: 'Désactivé', value: 0 },
  { label: '5 secondes', value: 5 },
  { label: '10 secondes', value: 10 },
  { label: '15 secondes', value: 15 },
  { label: '30 secondes', value: 30 },
  { label: '1 minute', value: 60 },
  { label: '2 minutes', value: 120 },
  { label: '5 minutes', value: 300 },
  { label: '10 minutes', value: 600 },
  { label: '1 heure', value: 3600 },
]

// Permissions affichables dans les overrides canal
const CHANNEL_PERMISSION_BITS = [
  { key: 'VIEW_CHANNEL',         bit: Math.pow(2, 18), label: 'Voir le salon' },
  { key: 'SEND_MESSAGES',        bit: Math.pow(2, 20), label: 'Envoyer des messages' },
  { key: 'READ_MESSAGE_HISTORY', bit: Math.pow(2, 25), label: 'Lire l\'historique' },
  { key: 'MANAGE_MESSAGES',      bit: Math.pow(2, 22), label: 'Gérer les messages' },
  { key: 'ATTACH_FILES',         bit: Math.pow(2, 24), label: 'Joindre des fichiers' },
  { key: 'ADD_REACTIONS',        bit: Math.pow(2, 29), label: 'Ajouter des réactions' },
  { key: 'EMBED_LINKS',          bit: Math.pow(2, 23), label: 'Intégrer des liens' },
  { key: 'MENTION_EVERYONE',     bit: Math.pow(2, 26), label: 'Mentionner @everyone' },
  { key: 'USE_SLASH_COMMANDS',   bit: Math.pow(2, 30), label: 'Slash commands' },
  { key: 'SEND_TTS_MESSAGES',    bit: Math.pow(2, 21), label: 'Messages TTS' },
  { key: 'MANAGE_THREADS',       bit: Math.pow(2, 36), label: 'Gérer les fils' },
  { key: 'CREATE_PUBLIC_THREADS',bit: Math.pow(2, 33), label: 'Créer fils publics' },
  { key: 'CONNECT_VOICE',        bit: Math.pow(2, 38), label: 'Rejoindre la voix' },
  { key: 'SPEAK',                bit: Math.pow(2, 39), label: 'Parler' },
  { key: 'STREAM',               bit: Math.pow(2, 40), label: 'Partager l\'écran' },
  { key: 'MUTE_MEMBERS_VOICE',   bit: Math.pow(2, 43), label: 'Rendre muet' },
  { key: 'DEAFEN_MEMBERS_VOICE', bit: Math.pow(2, 44), label: 'Rendre sourd' },
  { key: 'MOVE_MEMBERS',         bit: Math.pow(2, 45), label: 'Déplacer des membres' },
  { key: 'PRIORITY_SPEAKER',     bit: Math.pow(2, 42), label: 'Orateur prioritaire' },
]

const FORUM_SORT_OPTIONS = [
  { value: 'latest_activity', label: 'Dernière activité' },
  { value: 'creation_date', label: 'Date de création' },
  { value: 'most_replies', label: 'Nombre de réponses' },
  { value: 'most_reactions', label: 'Nombre de réactions' },
]

interface Channel {
  id: string
  name: string
  type: string
  topic?: string
  slowmode_delay: number
  user_limit?: number
  is_nsfw: boolean
  voice_password_hash?: string | null
  is_auto_create?: boolean
  auto_create_name?: string | null
  bitrate?: number
  default_sort?: string
  require_tag?: boolean
  position?: number
}

interface Props {
  channel: Channel
  serverId: string
  onClose: () => void
}

const isVoice = (t: string) => ['voice', 'video', 'stage'].includes(t)
const isText = (t: string) => ['text', 'announcement', 'forum'].includes(t)

type TabId = 'general' | 'permissions' | 'advanced'

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)}
      className={`relative inline-flex h-6 w-11 rounded-full transition-colors flex-shrink-0 ${value ? 'bg-fc-accent' : 'bg-fc-hover'}`}>
      <span className={`inline-block h-[18px] w-[18px] mt-[3px] rounded-full bg-white shadow transition-transform ${value ? 'translate-x-[23px]' : 'translate-x-[3px]'}`} />
    </button>
  )
}

// ─── Onglet Permissions ───────────────────────────────────────────────────────

function PermissionsTab({ channel, serverId }: { channel: Channel; serverId: string }) {
  const qc = useQueryClient()
  const [selectedTarget, setSelectedTarget] = useState<{ id: string; name: string; type: 'role' | 'user' } | null>(null)
  const [editAllow, setEditAllow] = useState(0)
  const [editDeny, setEditDeny] = useState(0)

  const { data: roles = [] } = useQuery({
    queryKey: ['roles', serverId],
    queryFn: () => api.get(`/servers/${serverId}/roles`).then(r => r.data),
    staleTime: 60_000,
  })

  const { data: overrides = [], refetch } = useQuery({
    queryKey: ['channel-permissions', channel.id],
    queryFn: () => api.get(`/channels/${channel.id}/permissions`).then(r => r.data).catch(() => []),
    staleTime: 30_000,
  })

  const saveOverride = useMutation({
    mutationFn: () => api.put(`/channels/${channel.id}/permissions/${selectedTarget!.id}`, {
      target_type: selectedTarget!.type,
      allow: editAllow,
      deny: editDeny,
    }),
    onSuccess: () => { refetch(); toast.success('Permissions sauvegardées') },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const deleteOverride = useMutation({
    mutationFn: (targetId: string) => api.delete(`/channels/${channel.id}/permissions/${targetId}`),
    onSuccess: () => { refetch(); setSelectedTarget(null); toast.success('Override supprimé') },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const selectTarget = (target: { id: string; name: string; type: 'role' | 'user' }) => {
    setSelectedTarget(target)
    const existing = (overrides as any[]).find((o: any) => o.target_id === target.id)
    setEditAllow(existing?.allow ?? 0)
    setEditDeny(existing?.deny ?? 0)
  }

  const addRole = (role: any) => {
    if (!(overrides as any[]).find((o: any) => o.target_id === role.id)) {
      api.put(`/channels/${channel.id}/permissions/${role.id}`, {
        target_type: 'role',
        allow: 0,
        deny: 0,
      }).then(() => refetch()).catch(() => {})
    }
    selectTarget({ id: role.id, name: role.name, type: 'role' })
  }

  const getState = (bit: number): 'allow' | 'deny' | 'neutral' => {
    const a = editAllow & bit
    const d = editDeny & bit
    if (a) return 'allow'
    if (d) return 'deny'
    return 'neutral'
  }

  const setState = (bit: number, state: 'allow' | 'deny' | 'neutral') => {
    setEditAllow(a => {
      let na = a
      if (state === 'allow') na = na | bit
      else na = na & ~bit
      return na
    })
    setEditDeny(d => {
      let nd = d
      if (state === 'deny') nd = nd | bit
      else nd = nd & ~bit
      return nd
    })
  }

  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* Targets list */}
      <div className="w-48 flex-shrink-0">
        <p className="text-xs text-fc-muted uppercase tracking-wide font-semibold mb-2">Rôles / Membres</p>
        <div className="space-y-0.5 mb-3">
          {(overrides as any[]).map((o: any) => {
            const role = (roles as any[]).find((r: any) => r.id === o.target_id)
            const name = role?.name ?? o.target_id.slice(0, 8)
            return (
              <button key={o.target_id}
                onClick={() => selectTarget({ id: o.target_id, name, type: o.target_type })}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-sm transition flex items-center gap-2
                  ${selectedTarget?.id === o.target_id ? 'bg-fc-accent/20 text-white' : 'text-fc-muted hover:text-white hover:bg-fc-hover/50'}`}>
                {o.target_type === 'role'
                  ? <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: role?.color ? '#' + role.color.toString(16).padStart(6, '0') : '#99aab5' }} />
                  : <Shield size={12} />
                }
                <span className="truncate">{name}</span>
              </button>
            )
          })}
        </div>

        {/* Ajouter un rôle */}
        <p className="text-xs text-fc-muted uppercase tracking-wide font-semibold mb-1">Ajouter</p>
        <div className="space-y-0.5">
          {(roles as any[]).filter((r: any) => !(overrides as any[]).find((o: any) => o.target_id === r.id)).map((r: any) => (
            <button key={r.id}
              onClick={() => addRole(r)}
              className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-fc-muted/60 hover:text-white hover:bg-fc-hover/30 transition flex items-center gap-1.5">
              <Plus size={10} />
              <span className="truncate">{r.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Permission editor */}
      {selectedTarget ? (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-3 flex-shrink-0">
            <h4 className="font-semibold text-white text-sm">{selectedTarget.name}</h4>
            <div className="flex items-center gap-2">
              <button onClick={() => saveOverride.mutate()}
                disabled={saveOverride.isPending}
                className="px-3 py-1 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition disabled:opacity-50">
                Sauvegarder
              </button>
              <button onClick={() => deleteOverride.mutate(selectedTarget.id)}
                className="p-1 text-fc-muted hover:text-red-400 rounded transition" title="Supprimer l'override">
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          {/* Légende */}
          <div className="flex gap-3 text-xs text-fc-muted mb-3 flex-shrink-0">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-500" /> Autorisé</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500" /> Refusé</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-fc-muted/30" /> Hérité</span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1 pr-1">
            {CHANNEL_PERMISSION_BITS.map(p => {
              const state = getState(p.bit)
              return (
                <div key={p.key}
                  className="flex items-center justify-between px-3 py-2 rounded-xl hover:bg-fc-hover/20 transition">
                  <span className="text-sm text-white">{p.label}</span>
                  <div className="flex items-center gap-1">
                    {/* Neutre */}
                    <button onClick={() => setState(p.bit, 'neutral')}
                      className={`w-6 h-6 rounded-full transition border-2 ${state === 'neutral' ? 'bg-fc-muted/30 border-fc-muted' : 'border-transparent hover:border-fc-muted/50'}`} />
                    {/* Autorisé */}
                    <button onClick={() => setState(p.bit, 'allow')}
                      className={`w-6 h-6 rounded-full transition flex items-center justify-center ${state === 'allow' ? 'bg-green-500' : 'hover:bg-green-500/20 border border-fc-hover'}`}>
                      {state === 'allow' && <span className="text-white text-xs">✓</span>}
                    </button>
                    {/* Refusé */}
                    <button onClick={() => setState(p.bit, 'deny')}
                      className={`w-6 h-6 rounded-full transition flex items-center justify-center ${state === 'deny' ? 'bg-red-500' : 'hover:bg-red-500/20 border border-fc-hover'}`}>
                      {state === 'deny' && <span className="text-white text-xs">✕</span>}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-fc-muted text-sm">
          Sélectionne un rôle pour modifier ses permissions dans ce canal
        </div>
      )}
    </div>
  )
}

// ─── Modal principale ─────────────────────────────────────────────────────────

export default function ChannelSettingsModal({ channel, serverId, onClose }: Props) {
  const qc = useQueryClient()
  const [tab, setTab] = useState<TabId>('general')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const [name, setName] = useState(channel.name)
  const [topic, setTopic] = useState(channel.topic ?? '')
  const [slowmode, setSlowmode] = useState(channel.slowmode_delay ?? 0)
  const [userLimit, setUserLimit] = useState(channel.user_limit ?? 0)
  const [isNsfw, setIsNsfw] = useState(channel.is_nsfw)
  const [voicePassword, setVoicePassword] = useState('')
  const [removePassword, setRemovePassword] = useState(false)
  const [hasExistingPassword] = useState(!!channel.voice_password_hash)
  const [isAutoCreate, setIsAutoCreate] = useState(channel.is_auto_create ?? false)
  const [autoCreateName, setAutoCreateName] = useState(channel.auto_create_name ?? '')
  const [bitrate, setBitrate] = useState(channel.bitrate ?? 64000)
  const [defaultSort, setDefaultSort] = useState(channel.default_sort ?? 'latest_activity')
  const [requireTag, setRequireTag] = useState(channel.require_tag ?? false)
  const [forumTags, setForumTags] = useState<string[]>([])
  const [newTag, setNewTag] = useState('')

  // Charger les tags forum
  useEffect(() => {
    if (channel.type === 'forum') {
      api.get(`/channels/${channel.id}/tags`).then(r => setForumTags(r.data || [])).catch(() => {})
    }
  }, [channel.id, channel.type])

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        name: name.trim() || undefined,
        topic: isText(channel.type) ? (topic.trim() || null) : undefined,
        slowmode_delay: isText(channel.type) ? slowmode : undefined,
        user_limit: isVoice(channel.type) ? (userLimit > 0 ? userLimit : null) : undefined,
        is_nsfw: isNsfw,
      }
      if (isVoice(channel.type)) {
        if (removePassword) payload.remove_voice_password = true
        else if (voicePassword.trim()) payload.voice_password = voicePassword.trim()
        payload.is_auto_create = isAutoCreate
        payload.auto_create_name = autoCreateName.trim() || null
        payload.bitrate = bitrate
      }
      if (channel.type === 'forum') {
        payload.default_sort = defaultSort
        payload.require_tag = requireTag
      }
      return api.patch(`/servers/${serverId}/channels/${channel.id}`, payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['server', serverId] })
      toast.success('Canal mis à jour')
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const deleteChannel = useMutation({
    mutationFn: () => api.delete(`/servers/${serverId}/channels/${channel.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['server', serverId] })
      toast.success('Canal supprimé')
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const addForumTag = () => {
    if (!newTag.trim()) return
    api.post(`/channels/${channel.id}/tags`, { name: newTag.trim() }).then(() => {
      setForumTags(t => [...t, newTag.trim()])
      setNewTag('')
    }).catch(() => setForumTags(t => [...t, newTag.trim()]))
  }

  const removeForumTag = (tag: string) => {
    api.delete(`/channels/${channel.id}/tags/${encodeURIComponent(tag)}`).catch(() => {})
    setForumTags(t => t.filter(x => x !== tag))
  }

  const TypeIcon = channel.type === 'voice' ? Volume2 : channel.type === 'video' ? Video
    : channel.type === 'stage' ? Radio : channel.type === 'announcement' ? Megaphone
    : channel.type === 'forum' ? MessagesSquare : Hash

  const typeColor = channel.type === 'voice' ? 'text-blue-400' : channel.type === 'video' ? 'text-purple-400'
    : channel.type === 'stage' ? 'text-pink-400' : channel.type === 'announcement' ? 'text-yellow-400'
    : channel.type === 'forum' ? 'text-green-400' : 'text-fc-muted'

  const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'general', label: 'Général', icon: <Settings size={14} /> },
    { id: 'permissions', label: 'Permissions', icon: <Lock size={14} /> },
    { id: 'advanced', label: 'Avancé', icon: <Shield size={14} /> },
  ]

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-3 md:px-0" onClick={onClose}>
      <div className="bg-fc-channel rounded-xl w-full max-w-[600px] max-h-[90dvh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-5 border-b border-fc-bg flex items-start justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <TypeIcon size={20} className={typeColor} />
            <div>
              <h2 className="font-bold text-white text-lg">#{channel.name}</h2>
              <p className="text-xs text-fc-muted capitalize">{channel.type}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-fc-muted hover:text-white transition p-1 rounded hover:bg-fc-hover">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 border-b border-fc-bg flex-shrink-0">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium transition border-b-2
                ${tab === t.id ? 'text-white border-fc-accent' : 'text-fc-muted border-transparent hover:text-white'}`}>
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* ─── GÉNÉRAL ─── */}
          {tab === 'general' && (
            <div className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">Nom du canal</label>
                <div className="relative">
                  <TypeIcon size={14} className={`absolute left-3 top-3 ${typeColor}`} />
                  <input value={name}
                    onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))}
                    maxLength={100}
                    className="w-full pl-8 pr-3 py-2 bg-fc-input rounded-lg text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
                  />
                </div>
              </div>

              {isText(channel.type) && (
                <div>
                  <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">
                    {channel.type === 'forum' ? 'Description du forum' : 'Sujet du canal'}
                    <span className="ml-2 normal-case font-normal">({topic.length}/1024)</span>
                  </label>
                  <textarea value={topic} onChange={e => setTopic(e.target.value)}
                    maxLength={1024} rows={3}
                    placeholder={channel.type === 'forum' ? 'À quoi sert ce forum ?' : 'Décrivez ce canal...'}
                    className="w-full px-3 py-2 bg-fc-input rounded-lg text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm resize-none"
                  />
                </div>
              )}

              {isText(channel.type) && (
                <div>
                  <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">Mode lent</label>
                  <select value={slowmode} onChange={e => setSlowmode(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-fc-input rounded-lg text-white outline-none text-sm">
                    {SLOWMODE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              )}

              {channel.type === 'forum' && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">Tri par défaut</label>
                    <select value={defaultSort} onChange={e => setDefaultSort(e.target.value)}
                      className="w-full px-3 py-2 bg-fc-input rounded-lg text-white outline-none text-sm">
                      {FORUM_SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-fc-bg/50 rounded-xl border border-fc-hover">
                    <div>
                      <div className="text-sm font-medium text-white">Exiger un tag</div>
                      <div className="text-xs text-fc-muted">Les posts doivent avoir un tag pour être créés</div>
                    </div>
                    <Toggle value={requireTag} onChange={setRequireTag} />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">Tags du forum</label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {forumTags.map(tag => (
                        <span key={tag} className="flex items-center gap-1 px-2.5 py-1 bg-fc-hover rounded-full text-xs text-white">
                          {tag}
                          <button onClick={() => removeForumTag(tag)} className="text-fc-muted hover:text-red-400 transition">
                            <X size={10} />
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input value={newTag} onChange={e => setNewTag(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addForumTag()}
                        placeholder="Nouveau tag..."
                        maxLength={20}
                        className="flex-1 px-3 py-1.5 bg-fc-input rounded-lg text-white outline-none text-sm"
                      />
                      <button onClick={addForumTag}
                        className="px-3 py-1.5 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-sm transition">
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>
                </>
              )}

              {isVoice(channel.type) && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">
                      Limite d'utilisateurs — <span className="text-white">{userLimit === 0 ? 'Illimité' : userLimit}</span>
                    </label>
                    <input type="range" min={0} max={99} value={userLimit}
                      onChange={e => setUserLimit(Number(e.target.value))}
                      className="w-full accent-fc-accent" />
                  </div>

                  {channel.type !== 'stage' && (
                    <div>
                      <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">
                        Débit audio — <span className="text-white">{Math.round(bitrate / 1000)} kbps</span>
                      </label>
                      <input type="range" min={8000} max={384000} step={8000} value={bitrate}
                        onChange={e => setBitrate(Number(e.target.value))}
                        className="w-full accent-fc-accent" />
                      <div className="flex justify-between text-xs text-fc-muted mt-0.5">
                        <span>8 kbps</span><span>384 kbps</span>
                      </div>
                    </div>
                  )}

                  {channel.type === 'voice' && (
                    <div>
                      <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">Mot de passe vocal</label>
                      {hasExistingPassword && (
                        <label className="flex items-center gap-2 text-xs text-fc-muted mb-2 cursor-pointer">
                          <input type="checkbox" checked={removePassword} onChange={e => setRemovePassword(e.target.checked)} className="accent-red-400" />
                          Supprimer le mot de passe existant
                        </label>
                      )}
                      {!removePassword && (
                        <input type="password" value={voicePassword} onChange={e => setVoicePassword(e.target.value)}
                          placeholder={hasExistingPassword ? 'Nouveau (vide = inchangé)' : 'Définir un mot de passe...'}
                          autoComplete="new-password"
                          className="w-full px-3 py-2 bg-fc-input rounded-lg text-white outline-none text-sm"
                        />
                      )}
                    </div>
                  )}

                  <div className="p-4 bg-fc-bg/50 rounded-xl border border-fc-hover space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-white">Canal auto-create</div>
                        <div className="text-xs text-fc-muted">Crée un vocal temporaire au join</div>
                      </div>
                      <Toggle value={isAutoCreate} onChange={setIsAutoCreate} />
                    </div>
                    {isAutoCreate && (
                      <input value={autoCreateName} onChange={e => setAutoCreateName(e.target.value)}
                        placeholder="{username}'s Channel"
                        className="w-full px-3 py-2 bg-fc-input rounded-lg text-white outline-none text-xs"
                      />
                    )}
                  </div>
                </>
              )}

              <div className="flex items-center justify-between p-3 bg-fc-bg/50 rounded-xl border border-fc-hover">
                <div>
                  <div className="text-sm font-medium text-white">Canal NSFW</div>
                  <div className="text-xs text-fc-muted">Contenu réservé aux adultes</div>
                </div>
                <Toggle value={isNsfw} onChange={setIsNsfw} />
              </div>
            </div>
          )}

          {/* ─── PERMISSIONS ─── */}
          {tab === 'permissions' && (
            <div className="h-[400px]">
              <PermissionsTab channel={channel} serverId={serverId} />
            </div>
          )}

          {/* ─── AVANCÉ ─── */}
          {tab === 'advanced' && (
            <div className="space-y-4">
              <div className="bg-fc-bg/50 rounded-xl border border-fc-hover p-4 space-y-3">
                <h4 className="text-sm font-semibold text-white">Informations</h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-fc-muted">ID : </span><span className="text-white font-mono">{channel.id.slice(0, 18)}...</span></div>
                  <div><span className="text-fc-muted">Type : </span><span className="text-white capitalize">{channel.type}</span></div>
                  <div><span className="text-fc-muted">Position : </span><span className="text-white">{channel.position ?? 'N/A'}</span></div>
                </div>
              </div>

              {channel.type === 'announcement' && (
                <div className="p-4 bg-yellow-500/10 rounded-xl border border-yellow-500/30">
                  <h4 className="text-sm font-semibold text-yellow-300 mb-1">Canal d'annonces</h4>
                  <p className="text-xs text-fc-muted">Les membres d'autres serveurs peuvent s'abonner à ce canal pour recevoir vos annonces directement dans leurs propres canaux.</p>
                </div>
              )}

              {channel.type === 'stage' && (
                <div className="p-4 bg-pink-500/10 rounded-xl border border-pink-500/30">
                  <h4 className="text-sm font-semibold text-pink-300 mb-1">Canal Scène (Stage)</h4>
                  <p className="text-xs text-fc-muted mb-2">Les modérateurs de scène peuvent gérer qui a le droit de parler. Idéal pour des événements, podcasts ou sessions Q&A.</p>
                  <p className="text-xs text-fc-muted">Les membres de l'audience peuvent demander la parole via le bouton dédié.</p>
                </div>
              )}

              <div className="border-t border-fc-hover pt-4">
                <h4 className="text-sm font-semibold text-red-400 mb-2">Zone dangereuse</h4>
                <button onClick={() => setShowDeleteConfirm(true)}
                  disabled={deleteChannel.isPending}
                  className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 rounded-lg text-sm hover:bg-red-500/20 transition">
                  <Trash2 size={14} />
                  Supprimer le canal #{channel.name}
                </button>
                {showDeleteConfirm && (
                  <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 px-4" onClick={() => setShowDeleteConfirm(false)}>
                    <div className="bg-fc-sidebar rounded-xl shadow-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
                      <h3 className="text-lg font-bold text-white mb-2">Supprimer #{channel.name}</h3>
                      <p className="text-sm text-fc-muted mb-5">Cette action est irréversible. Tous les messages seront perdus.</p>
                      <div className="flex gap-3 justify-end">
                        <button onClick={() => setShowDeleteConfirm(false)} className="px-4 py-2 text-sm rounded-lg bg-fc-hover hover:bg-fc-input text-white transition">Annuler</button>
                        <button onClick={() => { deleteChannel.mutate(); setShowDeleteConfirm(false) }} disabled={deleteChannel.isPending} className="px-4 py-2 text-sm rounded-lg bg-red-500 hover:bg-red-600 text-white font-semibold transition disabled:opacity-50">Supprimer</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {tab !== 'permissions' && (
          <div className="px-5 py-4 border-t border-fc-bg flex justify-end gap-3 flex-shrink-0">
            <button onClick={onClose} className="px-4 py-2 text-fc-muted hover:text-white transition text-sm">Annuler</button>
            {tab === 'general' && (
              <button onClick={() => save.mutate()} disabled={save.isPending}
                className="px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition disabled:opacity-50">
                {save.isPending ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

import React from 'react'
