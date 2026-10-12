import { useState, useEffect } from 'react'
import { X, Hash, Volume2, Video, Radio, Megaphone, MessagesSquare, Lock, Shield, Settings, Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client'
import toast from 'react-hot-toast'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useAuth } from '../../store/auth'
import { useServerPerms } from '../../hooks/useServerPerms'
import { deleteWithBackup } from '../../lib/deleteWithBackup'
import ChannelFollowsSection from './ChannelFollowsSection'
import ChannelMessagingSection from './ChannelMessagingSection'
import { useT, type Key } from '../../i18n'

// Libellés : clés slowmode.<secondes>.
const SLOWMODE_OPTIONS = [0, 5, 10, 15, 30, 60, 120, 300, 600, 3600] as const

// Permissions affichables dans les overrides canal — mêmes bits que le serveur
// (server/src/models/role.rs::Permissions), seuls appliqués. Libellés : clés chperm.<key>.
const CHANNEL_PERMISSION_BITS = [
  { key: 'VIEW_CHANNEL',     bit: Math.pow(2, 0) },
  { key: 'SEND_MESSAGES',    bit: Math.pow(2, 1) },
  { key: 'READ_HISTORY',     bit: Math.pow(2, 2) },
  { key: 'MANAGE_MESSAGES',  bit: Math.pow(2, 3) },
  { key: 'ATTACH_FILES',     bit: Math.pow(2, 10) },
  { key: 'ADD_REACTIONS',    bit: Math.pow(2, 12) },
  { key: 'EMBED_LINKS',      bit: Math.pow(2, 11) },
  { key: 'MENTION_EVERYONE', bit: Math.pow(2, 9) },
  { key: 'CONNECT_VOICE',    bit: Math.pow(2, 13) },
  { key: 'SPEAK_VOICE',      bit: Math.pow(2, 14) },
  { key: 'STREAM',           bit: Math.pow(2, 40) },
  { key: 'MUTE_MEMBERS',     bit: Math.pow(2, 15) },
  { key: 'DEAFEN_MEMBERS',   bit: Math.pow(2, 16) },
  { key: 'MOVE_MEMBERS',     bit: Math.pow(2, 17) },
] as const

const FORUM_SORT_OPTIONS = ['latest_activity', 'creation_date', 'most_replies', 'most_reactions'] as const

interface Channel {
  id: string
  name: string
  type: string
  topic?: string
  slowmode_delay: number
  user_limit?: number
  is_nsfw: boolean
  has_voice_password?: boolean
  is_temporary?: boolean
  created_by_auto?: string | null
  created_by?: string | null
  is_auto_create?: boolean
  auto_create_name?: string | null
  waiting_room?: boolean
  bitrate?: number
  default_sort?: string
  require_tag?: boolean
  position?: number
  disappear_seconds?: number | null
  auto_threads?: boolean
}

type Target = { id: string; name: string; type: 'role' | 'member' }

interface Props {
  channel: Channel
  serverId: string
  onClose: () => void
  /** Ouverture depuis le menu d'un membre : onglet Permissions, surcharge de ce membre sélectionnée. */
  initialTab?: TabId
  initialTarget?: Target
}

const isVoice = (t: string) => ['voice', 'video', 'stage'].includes(t)
const isText = (t: string) => ['text', 'announcement', 'forum', 'media'].includes(t)

type TabId = 'general' | 'permissions' | 'advanced'

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={value} aria-label={label} onClick={() => onChange(!value)}
      className={`relative inline-flex h-6 w-11 rounded-full transition-colors flex-shrink-0 ${value ? 'bg-fc-accent' : 'bg-fc-hover'}`}>
      <span className={`inline-block h-[18px] w-[18px] mt-[3px] rounded-full bg-white shadow transition-transform ${value ? 'translate-x-[23px]' : 'translate-x-[3px]'}`} />
    </button>
  )
}

// ─── Onglet Permissions ───────────────────────────────────────────────────────

function PermissionsTab({ channel, serverId, initialTarget }: { channel: Channel; serverId: string; initialTarget?: Target }) {
  const t = useT()
  const qc = useQueryClient()
  const [selectedTarget, setSelectedTarget] = useState<Target | null>(initialTarget ?? null)
  const [editAllow, setEditAllow] = useState(0)
  const [editDeny, setEditDeny] = useState(0)

  const { data: roles = [] } = useQuery({
    queryKey: ['roles', serverId],
    queryFn: () => api.get(`/servers/${serverId}/roles`).then(r => r.data),
    staleTime: 60_000,
  })

  const { data: overrides = [], refetch, isFetched } = useQuery({
    queryKey: ['channel-permissions', channel.id],
    queryFn: () => api.get(`/channels/${channel.id}/permissions`).then(r => r.data).catch(() => []),
    staleTime: 30_000,
  })
  // Membre choisi depuis son menu : sa surcharge existante, une fois la liste chargée.
  const [initialLoaded, setInitialLoaded] = useState(!initialTarget)
  useEffect(() => {
    if (initialLoaded || !isFetched || !initialTarget) return
    const existing = (overrides as any[]).find((o: any) => o.target_id === initialTarget.id)
    setEditAllow(existing?.allow ?? 0)
    setEditDeny(existing?.deny ?? 0)
    setInitialLoaded(true)
  }, [initialLoaded, isFetched, initialTarget, overrides])

  const saveOverride = useMutation({
    mutationFn: () => api.put(`/channels/${channel.id}/permissions/${selectedTarget!.id}`, {
      target_type: selectedTarget!.type,
      allow: editAllow,
      deny: editDeny,
    }),
    onSuccess: () => { refetch(); toast.success(t('chset.permsSaved')) },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('common.error')),
  })

  const deleteOverride = useMutation({
    mutationFn: (targetId: string) => api.delete(`/channels/${channel.id}/permissions/${targetId}`),
    onSuccess: () => { refetch(); setSelectedTarget(null); toast.success(t('chset.overrideDeleted')) },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('common.error')),
  })

  const selectTarget = (target: Target) => {
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
        <p className="text-xs text-fc-muted uppercase tracking-wide font-semibold mb-2">{t('chset.targets')}</p>
        <div className="space-y-0.5 mb-3">
          {(overrides as any[]).map((o: any) => {
            const role = (roles as any[]).find((r: any) => r.id === o.target_id)
            const name = role?.name ?? (initialTarget && o.target_id === initialTarget.id ? initialTarget.name : o.target_id.slice(0, 8))
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
        <p className="text-xs text-fc-muted uppercase tracking-wide font-semibold mb-1">{t('chset.add')}</p>
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
                {t('common.save')}
              </button>
              <button onClick={() => deleteOverride.mutate(selectedTarget.id)}
                className="p-1 text-fc-muted hover:text-red-400 rounded transition" title={t('chset.deleteOverride')} aria-label={t('chset.deleteOverride')}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          {/* Légende */}
          <div className="flex gap-3 text-xs text-fc-muted mb-3 flex-shrink-0">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-500" /> {t('chset.allowed')}</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500" /> {t('chset.denied')}</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-fc-muted/30" /> {t('chset.inherited')}</span>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain space-y-1 pr-1">
            {CHANNEL_PERMISSION_BITS.map(p => {
              const state = getState(p.bit)
              return (
                <div key={p.key}
                  className="flex items-center justify-between px-3 py-2 rounded-xl hover:bg-fc-hover/20 transition">
                  <span className="text-sm text-white">{t(`chperm.${p.key}`)}</span>
                  <div className="flex items-center gap-1">
                    {/* Neutre */}
                    <button onClick={() => setState(p.bit, 'neutral')} aria-label={`${t(`chperm.${p.key}`)} : ${t('chset.inherited')}`} aria-pressed={state === 'neutral'}
                      className={`w-6 h-6 rounded-full transition border-2 ${state === 'neutral' ? 'bg-fc-muted/30 border-fc-muted' : 'border-transparent hover:border-fc-muted/50'}`} />
                    {/* Autorisé */}
                    <button onClick={() => setState(p.bit, 'allow')} aria-label={`${t(`chperm.${p.key}`)} : ${t('chset.allowed')}`} aria-pressed={state === 'allow'}
                      className={`w-6 h-6 rounded-full transition flex items-center justify-center ${state === 'allow' ? 'bg-green-500' : 'hover:bg-green-500/20 border border-fc-hover'}`}>
                      {state === 'allow' && <span className="text-white text-xs">✓</span>}
                    </button>
                    {/* Refusé */}
                    <button onClick={() => setState(p.bit, 'deny')} aria-label={`${t(`chperm.${p.key}`)} : ${t('chset.denied')}`} aria-pressed={state === 'deny'}
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
          {t('chset.pickRole')}
        </div>
      )}
    </div>
  )
}

// ─── Modal principale ─────────────────────────────────────────────────────────

export default function ChannelSettingsModal({ channel, serverId, onClose, initialTab, initialTarget }: Props) {
  const t = useT()
  useEscapeKey(onClose)
  const qc = useQueryClient()
  const [tab, setTab] = useState<TabId>(initialTab ?? 'general')
  const { canEditChannels, canDeleteChannel } = useServerPerms(serverId)
  const [deleting, setDeleting] = useState(false)

  const [name, setName] = useState(channel.name)
  const [topic, setTopic] = useState(channel.topic ?? '')
  const [slowmode, setSlowmode] = useState(channel.slowmode_delay ?? 0)
  const [userLimit, setUserLimit] = useState(channel.user_limit ?? 0)
  const [isNsfw, setIsNsfw] = useState(channel.is_nsfw)
  const [voicePassword, setVoicePassword] = useState('')
  const [removePassword, setRemovePassword] = useState(false)
  const [hasExistingPassword] = useState(!!channel.has_voice_password)
  const [isAutoCreate, setIsAutoCreate] = useState(channel.is_auto_create ?? false)
  const [autoCreateName, setAutoCreateName] = useState(channel.auto_create_name ?? '')
  const [waitingRoom, setWaitingRoom] = useState(!!channel.waiting_room)
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

  // P3-3 — créateur d'un salon temporaire : nom, limite de places et
  // verrou (mot de passe) seulement ; le serveur refuse tout autre champ.
  const meId = useAuth(s => s.user?.id)
  const ownsTemp = !!channel.is_temporary && !!meId && channel.created_by_auto === meId

  const save = useMutation({
    mutationFn: () => {
      if (ownsTemp) {
        const payload: Record<string, unknown> = {
          name: name.trim() || undefined,
          user_limit: userLimit > 0 ? userLimit : null,
        }
        if (removePassword) payload.remove_voice_password = true
        else if (voicePassword.trim()) payload.voice_password = voicePassword.trim()
        return api.patch(`/servers/${serverId}/channels/${channel.id}`, payload)
      }
      const payload: Record<string, unknown> = {
        name: name.trim() || undefined,
        // Chaîne vide et non `null` : le serveur fait COALESCE et ignorerait `null`.
        topic: isText(channel.type) ? topic.trim() : undefined,
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
      return api.patch(`/servers/${serverId}/channels/${channel.id}`, payload).then(async r => {
        // Salle d'attente : route dédiée (MANAGE_CHANNELS).
        if (isVoice(channel.type) && waitingRoom !== !!channel.waiting_room) {
          await api.put(`/servers/${serverId}/channels/${channel.id}/waiting-room`, { enabled: waitingRoom })
        }
        return r
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['server', serverId] })
      toast.success(t('chset.updated'))
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('common.error')),
  })

  const removeChannel = async () => {
    setDeleting(true)
    const serverName = qc.getQueryData<any>(['server', serverId])?.server?.name
    const done = await deleteWithBackup({ kind: 'channel', serverId, serverName, id: channel.id, name: channel.name })
    setDeleting(false)
    if (!done) return
    qc.invalidateQueries({ queryKey: ['server', serverId] })
    toast.success(t('chset.deleted'))
    onClose()
  }

  const addForumTag = () => {
    const tag = newTag.trim()
    if (!tag) return
    api.post(`/channels/${channel.id}/tags`, { name: tag }).then(() => {
      setForumTags(tags => [...tags, tag])
      setNewTag('')
    }).catch((e: any) => toast.error(e.response?.data?.error ?? t('chset.tagAddError')))
  }

  const removeForumTag = (tag: string) => {
    setForumTags(tags => tags.filter(x => x !== tag))
    api.delete(`/channels/${channel.id}/tags/${encodeURIComponent(tag)}`).catch((e: any) => {
      setForumTags(tags => tags.includes(tag) ? tags : [...tags, tag])
      toast.error(e.response?.data?.error ?? t('chset.tagRemoveError'))
    })
  }

  const TypeIcon = channel.type === 'voice' ? Volume2 : channel.type === 'video' ? Video
    : channel.type === 'stage' ? Radio : channel.type === 'announcement' ? Megaphone
    : channel.type === 'forum' ? MessagesSquare : Hash

  const typeColor = channel.type === 'voice' ? 'text-blue-400' : channel.type === 'video' ? 'text-purple-400'
    : channel.type === 'stage' ? 'text-pink-400' : channel.type === 'announcement' ? 'text-yellow-400'
    : channel.type === 'forum' ? 'text-green-400' : 'text-fc-muted'

  const TABS: { id: TabId; label: Key; icon: React.ReactNode }[] = [
    { id: 'general', label: 'chset.tab.general', icon: <Settings size={14} /> },
    ...(canEditChannels ? [{ id: 'permissions' as TabId, label: 'chset.tab.permissions' as Key, icon: <Lock size={14} /> }] : []),
    { id: 'advanced', label: 'settings.section.advanced', icon: <Shield size={14} /> },
  ]

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-3 md:px-0" onClick={onClose}>
      <div className="bg-fc-channel rounded-xl w-full max-w-[600px] max-h-[90dvh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="channel-settings-modal-title">
        {/* Header */}
        <div className="p-5 border-b border-fc-bg flex items-start justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <TypeIcon size={20} className={typeColor} />
            <div>
              <h2 id="channel-settings-modal-title" className="font-bold text-white text-lg">#{channel.name}</h2>
              <p className="text-xs text-fc-muted">{t(`chtype.${channel.type}` as Key)}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label={t('common.close')} className="text-fc-muted hover:text-white transition p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-fc-hover">
            <X size={18} aria-hidden />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 border-b border-fc-bg flex-shrink-0">
          {TABS.map(tb => (
            <button key={tb.id} onClick={() => setTab(tb.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium transition border-b-2
                ${tab === tb.id ? 'text-white border-fc-accent' : 'text-fc-muted border-transparent hover:text-white'}`}>
              {tb.icon}
              {t(tb.label)}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-5">
          {/* ─── GÉNÉRAL ─── */}
          {tab === 'general' && (
            <div className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">{t('createChannel.name')}</label>
                <div className="relative">
                  <TypeIcon size={14} className={`absolute left-3 top-3 ${typeColor}`} />
                  <input value={name}
                    onChange={e => setName(e.target.value)}
                    maxLength={100}
                    enterKeyHint="done"
                    autoComplete="off"
                    className="w-full pl-8 pr-3 py-2 bg-fc-input rounded-lg text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
                  />
                </div>
              </div>

              {isText(channel.type) && (
                <div>
                  <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">
                    {channel.type === 'forum' ? t('createChannel.forumDesc') : t('chset.topic')}
                    <span className="ml-2 normal-case font-normal">({topic.length}/1024)</span>
                  </label>
                  <textarea value={topic} onChange={e => setTopic(e.target.value)}
                    maxLength={1024} rows={3}
                    placeholder={channel.type === 'forum' ? t('createChannel.forumDescPh') : t('chset.topicPh')}
                    className="w-full px-3 py-2 bg-fc-input rounded-lg text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm resize-none"
                  />
                </div>
              )}

              {isText(channel.type) && (
                <div>
                  <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">{t('createChannel.slowmode')}</label>
                  <select value={slowmode} onChange={e => setSlowmode(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-fc-input rounded-lg text-white outline-none text-sm">
                    {SLOWMODE_OPTIONS.map(v => <option key={v} value={v}>{t(`slowmode.${v}`)}</option>)}
                  </select>
                </div>
              )}

              {(channel.type === 'text' || channel.type === 'announcement') && canEditChannels && (
                <ChannelMessagingSection serverId={serverId} channelId={channel.id}
                  disappearSeconds={channel.disappear_seconds} autoThreads={channel.auto_threads} />
              )}

              {channel.type === 'forum' && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">{t('chset.defaultSort')}</label>
                    <select value={defaultSort} onChange={e => setDefaultSort(e.target.value)}
                      className="w-full px-3 py-2 bg-fc-input rounded-lg text-white outline-none text-sm">
                      {FORUM_SORT_OPTIONS.map(v => <option key={v} value={v}>{t(`forumSort.${v}`)}</option>)}
                    </select>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-fc-bg/50 rounded-xl border border-fc-hover">
                    <div>
                      <div className="text-sm font-medium text-white">{t('chset.requireTag')}</div>
                      <div className="text-xs text-fc-muted">{t('chset.requireTagDesc')}</div>
                    </div>
                    <Toggle value={requireTag} onChange={setRequireTag} label={t('chset.requireTag')} />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">{t('chset.forumTags')}</label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {forumTags.map(tag => (
                        <span key={tag} className="flex items-center gap-1 px-2.5 py-1 bg-fc-hover rounded-full text-xs text-white">
                          {tag}
                          <button onClick={() => removeForumTag(tag)} aria-label={t('chset.removeTag', { tag })} className="text-fc-muted hover:text-red-400 transition">
                            <X size={10} />
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input value={newTag} onChange={e => setNewTag(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addForumTag()}
                        placeholder={t('chset.newTag')}
                        aria-label={t('chset.newTag')}
                        maxLength={20}
                        enterKeyHint="done"
                        autoCapitalize="none"
                        className="flex-1 px-3 py-1.5 bg-fc-input rounded-lg text-white outline-none text-sm"
                      />
                      <button onClick={addForumTag} aria-label={t('chset.addTag')}
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
                      {t('createChannel.userLimit')} — <span className="text-white">{userLimit === 0 ? t('invite.unlimited') : userLimit}</span>
                    </label>
                    <input type="range" min={0} max={99} value={userLimit}
                      onChange={e => setUserLimit(Number(e.target.value))}
                      className="w-full accent-fc-accent" />
                  </div>

                  {channel.type !== 'stage' && !ownsTemp && (
                    <div>
                      <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">
                        {t('chset.bitrate')} — <span className="text-white">{Math.round(bitrate / 1000)} kbps</span>
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
                      <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">
                        {ownsTemp ? t('chset.lock') : t('chset.voicePassword')}
                      </label>
                      {hasExistingPassword && (
                        <label className="flex items-center gap-2 text-xs text-fc-muted mb-2 cursor-pointer">
                          <input type="checkbox" checked={removePassword} onChange={e => setRemovePassword(e.target.checked)} className="accent-red-400" />
                          {t('chset.removePassword')}
                        </label>
                      )}
                      {!removePassword && (
                        <input type="password" value={voicePassword} onChange={e => setVoicePassword(e.target.value)}
                          placeholder={hasExistingPassword ? t('chset.newPassword') : t('chset.setPassword')}
                          aria-label={t('chset.voicePassword')}
                          autoComplete="new-password"
                          className="w-full px-3 py-2 bg-fc-input rounded-lg text-white outline-none text-sm"
                        />
                      )}
                    </div>
                  )}

                  {!ownsTemp && <div className="p-4 bg-fc-bg/50 rounded-xl border border-fc-hover space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-white">{t('chset.autoCreate')}</div>
                        <div className="text-xs text-fc-muted">{t('chset.autoCreateDesc')}</div>
                      </div>
                      <Toggle value={isAutoCreate} onChange={setIsAutoCreate} label={t('chset.autoCreate')} />
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-white">{t('chset.waitingRoom')}</div>
                        <div className="text-xs text-fc-muted">{t('chset.waitingRoomDesc')}</div>
                      </div>
                      <Toggle value={waitingRoom} onChange={setWaitingRoom} label={t('chset.waitingRoom')} />
                    </div>
                    {isAutoCreate && (
                      <input value={autoCreateName} onChange={e => setAutoCreateName(e.target.value)}
                        placeholder="{username}'s Channel"
                        enterKeyHint="done"
                        autoCapitalize="none"
                        className="w-full px-3 py-2 bg-fc-input rounded-lg text-white outline-none text-xs"
                      />
                    )}
                  </div>}
                </>
              )}

              {!ownsTemp && <div className="flex items-center justify-between p-3 bg-fc-bg/50 rounded-xl border border-fc-hover">
                <div>
                  <div className="text-sm font-medium text-white">{t('createChannel.nsfw')}</div>
                  <div className="text-xs text-fc-muted">{t('chset.nsfwDesc')}</div>
                </div>
                <Toggle value={isNsfw} onChange={setIsNsfw} label={t('createChannel.nsfw')} />
              </div>}
            </div>
          )}

          {/* ─── PERMISSIONS ─── */}
          {tab === 'permissions' && (
            <div className="h-[400px]">
              <PermissionsTab channel={channel} serverId={serverId} initialTarget={initialTarget} />
            </div>
          )}

          {/* ─── AVANCÉ ─── */}
          {tab === 'advanced' && (
            <div className="space-y-4">
              <div className="bg-fc-bg/50 rounded-xl border border-fc-hover p-4 space-y-3">
                <h4 className="text-sm font-semibold text-white">{t('chset.info')}</h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-fc-muted">ID : </span><span className="text-white font-mono streamer-id">{channel.id.slice(0, 18)}...</span></div>
                  <div><span className="text-fc-muted">{t('chset.typeLabel')} </span><span className="text-white">{t(`chtype.${channel.type}` as Key)}</span></div>
                  <div><span className="text-fc-muted">Position : </span><span className="text-white">{channel.position ?? 'N/A'}</span></div>
                </div>
              </div>

              {(channel.type === 'announcement' || channel.type === 'text') && (
                <ChannelFollowsSection channelId={channel.id} isAnnouncement={channel.type === 'announcement'} />
              )}

              {channel.type === 'stage' && (
                <div className="p-4 bg-pink-500/10 rounded-xl border border-pink-500/30">
                  <h4 className="text-sm font-semibold text-pink-300 mb-1">{t('chset.stage')}</h4>
                  <p className="text-xs text-fc-muted">{t('chset.stageDesc')}</p>
                </div>
              )}

              {canDeleteChannel(channel.created_by) && (
                <div className="border-t border-fc-hover pt-4">
                  <h4 className="text-sm font-semibold text-red-400 mb-2">{t('settings.adv.danger')}</h4>
                  <button onClick={removeChannel}
                    disabled={deleting}
                    className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 rounded-lg text-sm hover:bg-red-500/20 transition disabled:opacity-50">
                    <Trash2 size={14} />
                    {t('chset.delete', { name: channel.name })}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {tab !== 'permissions' && (
          <div className="px-5 py-4 border-t border-fc-bg flex justify-end gap-3 flex-shrink-0">
            <button onClick={onClose} className="px-4 py-2 text-fc-muted hover:text-white transition text-sm">{t('common.cancel')}</button>
            {tab === 'general' && (canEditChannels || ownsTemp) && (
              <button onClick={() => save.mutate()} disabled={save.isPending}
                className="px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition disabled:opacity-50">
                {save.isPending ? t('common.recording') : t('common.record')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

import React from 'react'
