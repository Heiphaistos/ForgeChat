import { useState, useEffect } from 'react'
import { X, Hash, Volume2, Video, Radio, Megaphone, MessagesSquare, Lock, Shield, Settings, Plus, Trash2 } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client'
import toast from 'react-hot-toast'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useAuth } from '../../store/auth'
import { useServerPerms } from '../../hooks/useServerPerms'
import { deleteWithBackup } from '../../lib/deleteWithBackup'
import ChannelFollowsSection from './ChannelFollowsSection'
import ChannelMessagingSection from './ChannelMessagingSection'
import { useT, type Key } from '../../i18n'
import PermissionOverridesEditor, { type OverrideTarget } from './PermissionOverridesEditor'
import ForumSettingsSection from './ForumSettingsSection'

// Libellés : clés slowmode.<secondes>.
const SLOWMODE_OPTIONS = [0, 5, 10, 15, 30, 60, 120, 300, 600, 3600] as const

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
  default_reaction_emoji?: string | null
  post_guidelines?: string | null
}

type Target = OverrideTarget

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
                  <input aria-label={t('createChannel.name')} value={name}
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
                  <select aria-label={t('createChannel.slowmode')} value={slowmode} onChange={e => setSlowmode(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-fc-input rounded-lg text-white outline-none text-sm">
                    {SLOWMODE_OPTIONS.map(v => <option key={v} value={v}>{t(`slowmode.${v}`)}</option>)}
                  </select>
                </div>
              )}

              {(channel.type === 'text' || channel.type === 'announcement') && canEditChannels && (
                <ChannelMessagingSection serverId={serverId} channelId={channel.id}
                  disappearSeconds={channel.disappear_seconds} autoThreads={channel.auto_threads} />
              )}

              {(channel.type === 'forum' || channel.type === 'media') && canEditChannels && (
                <ForumSettingsSection serverId={serverId} channel={channel} />
              )}

              {channel.type === 'forum' && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">{t('chset.defaultSort')}</label>
                    <select aria-label={t('chset.defaultSort')} value={defaultSort} onChange={e => setDefaultSort(e.target.value)}
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
                    <input aria-label={t('createChannel.userLimit')} type="range" min={0} max={99} value={userLimit}
                      onChange={e => setUserLimit(Number(e.target.value))}
                      className="w-full accent-fc-accent" />
                  </div>

                  {channel.type !== 'stage' && !ownsTemp && (
                    <div>
                      <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">
                        {t('chset.bitrate')} — <span className="text-white">{Math.round(bitrate / 1000)} kbps</span>
                      </label>
                      <input aria-label={t('chset.bitrate')} type="range" min={8000} max={384000} step={8000} value={bitrate}
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
              <PermissionOverridesEditor basePath={`/channels/${channel.id}/permissions`} queryKey={['channel-permissions', channel.id]}
                serverId={serverId} initialTarget={initialTarget} />
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
                  <div><span className="text-fc-muted">{t('hc.chset.position')}</span><span className="text-white">{channel.position ?? 'N/A'}</span></div>
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
