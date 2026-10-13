import { useState, useRef } from 'react'
import BirthdayChannelSetting from '../server/BirthdayChannelSetting'
import { createPortal } from 'react-dom'
import { X, Trash2, Upload, SmilePlus, Bot, Plus, RefreshCw, Copy, Check, Shield, Users, Ban, Tag, Link, ScrollText, Rss, BarChart2, Image, Calendar, Sparkles, Lock, Trophy, Palette, Ticket } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api, { mediaUrl } from '../../api/client'
import ProfileBanner from '../ui/ProfileBanner'
import ServerAppearanceTab from './ServerAppearanceTab'
import toast from 'react-hot-toast'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useServerPerms, PERM } from '../../hooks/useServerPerms'
import { useAuth } from '../../store/auth'
import RolesTab from './RolesTab'
import TransferOwnershipSection from './TransferOwnershipSection'
import DeleteServerModal from './DeleteServerModal'
import MembersTab from './MembersTab'
import BansTab from './BansTab'
import TagsTab from './TagsTab'
import WebhooksTab from './WebhooksTab'
import AuditLogTab from './AuditLogTab'
import AutoModTab from './AutoModTab'
import FeedsTab from './FeedsTab'
import DiscordSyncTab from './DiscordSyncTab'
import StatsTab from './StatsTab'
import InviteTrackingTab from './InviteTrackingTab'
import OnboardingTab from './OnboardingTab'
import ServerEventsPage from '../../pages/ServerEventsPage'
import SaveAsTemplateButton from './SaveAsTemplateButton'
import MyServerProfileTab from './MyServerProfileTab'
import ServerKeySettings from '../../e2e/ServerKeySettings'
import CommunitySettings from '../community/CommunitySettings'
import { useT, type Key } from '../../i18n'

interface Server {
  id: string
  owner_id?: string
  name: string
  icon?: string | null
  banner?: string | null
  description?: string
  welcome_message?: string | null
  is_public: boolean
  member_count: number
  verification_enabled?: boolean
  verification_rules?: string | null
  system_channel_id?: string | null
  afk_channel_id?: string | null
  afk_timeout_minutes?: number | null
  rules_channel_id?: string | null
  vanity_url?: string | null
  content_filter?: string
  default_notification_level?: string
  banner_url?: string | null
  server_category?: string | null
  role_color_overrides_name?: boolean
  boost_level?: number
  boost_count?: number
  raid_protection?: boolean
  require_2fa_for_moderation?: boolean
  server_locale?: string
  max_video_channel_users?: number
  discovery_tags?: string[]
}

interface Props {
  server: Server
  onClose: () => void
  isAdmin?: boolean
  /** Onglet ouvert d'emblée (menu du serveur : rôles, bots, événements, profil, tags). */
  initialTab?: ServerSettingsTab
}

export type ServerSettingsTab = 'general' | 'appearance' | 'profile' | 'e2e' | 'roles' | 'members' | 'bans' | 'tags' | 'emojis' | 'bots' | 'webhooks' | 'audit' | 'automod' | 'feeds' | 'discordSync' | 'stats' | 'events' | 'onboarding' | 'community' | 'invites'

function BoostSection({ server }: { server: any }) {
  // Boost gratuit (un par membre et par serveur) : même appel que le bouton de la barre des salons.
  const t = useT()
  const qc = useQueryClient()
  const boost = useMutation({
    mutationFn: () => api.post(`/servers/${server.id}/boost`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['server', server.id] })
      qc.invalidateQueries({ queryKey: ['servers'] })
      toast.success(t('srv.boostThanks'))
    },
    onError: () => toast.error(t('srv.boostError')),
  })
  const LEVELS = [
    { level: 1, threshold: 2, label: t('srv.level', { n: 1 }), color: 'from-indigo-500 to-purple-500' },
    { level: 2, threshold: 7, label: t('srv.level', { n: 2 }), color: 'from-purple-500 to-fuchsia-500' },
    { level: 3, threshold: 14, label: t('srv.level', { n: 3 }), color: 'from-amber-500 to-yellow-400' },
  ]
  const currentLevel = server?.boost_level ?? 0
  const count = server?.boost_count ?? 0
  const next = LEVELS.find(l => l.level === currentLevel + 1)
  const progress = next ? Math.min(100, (count / next.threshold) * 100) : 100

  return (
    <div className="mt-4 p-4 bg-fc-channel rounded-xl">
      <h3 className="text-sm font-semibold text-white mb-3">{t('srv.boosts')}</h3>
      <div className="flex items-center gap-3 mb-3">
        <span className="text-2xl font-bold text-white">{count}</span>
        <span className="text-fc-muted text-sm">{t(count !== 1 ? 'srv.activeBoosts.other' : 'srv.activeBoosts.one')}</span>
        {currentLevel > 0 && (
          <span className="ml-auto px-2 py-0.5 bg-fc-accent/20 text-fc-accent text-xs rounded-full">
            {t('srv.level', { n: currentLevel })}
          </span>
        )}
      </div>
      {next && (
        <>
          <div className="w-full bg-fc-bg rounded-full h-2 mb-1">
            <div
              className={`h-2 rounded-full bg-gradient-to-r ${next.color} transition-all`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-fc-muted">{t('srv.boostProgress', { count, threshold: next.threshold, level: next.label })}</p>
        </>
      )}
      <button
        className="mt-3 w-full py-2 bg-fc-accent/10 hover:bg-fc-accent/20 text-fc-accent text-sm rounded-lg transition"
        onClick={() => boost.mutate()}
        disabled={boost.isPending}
      >
        {t('srv.boostButton')}
      </button>
    </div>
  )
}

type Tab = ServerSettingsTab

export default function ServerSettingsModal({ server, onClose, isAdmin = false, initialTab = 'general' }: Props) {
  const t = useT()
  useEscapeKey(onClose)
  // Liste des bans : bannir définitivement OU temporairement.
  const perms = useServerPerms(server.id)
  const canSeeBans = perms.has(PERM.BAN_MEMBERS | PERM.BAN_TEMP)
  const canManageServer = perms.has(PERM.MANAGE_SERVER)
  const [tab, setTab] = useState<Tab>(initialTab)
  const [mobileShowContent, setMobileShowContent] = useState(initialTab !== 'general')
  const [name, setName] = useState(server.name)
  const [description, setDescription] = useState(server.description ?? '')
  const [welcomeMessage, setWelcomeMessage] = useState(server.welcome_message ?? '')
  const [bannerUrl, setBannerUrl] = useState(server.banner ?? '')
  const [isPublic, setIsPublic] = useState(server.is_public)
  const [roleColorWins, setRoleColorWins] = useState(server.role_color_overrides_name !== false)
  const [verificationEnabled, setVerificationEnabled] = useState(server.verification_enabled ?? false)
  const [verificationRules, setVerificationRules] = useState(server.verification_rules ?? '')
  const [showDelete, setShowDelete] = useState(false)
  // Seul le propriétaire peut supprimer (le serveur refuse les autres en 403) : la zone n'est montrée qu'à lui.
  const estProprietaire = useAuth(st => st.user?.id) === server.owner_id
  const [systemChannelId, setSystemChannelId] = useState<string>(server.system_channel_id ?? '')
  const [afkChannelId, setAfkChannelId] = useState<string>(server.afk_channel_id ?? '')
  const [afkTimeout, setAfkTimeout] = useState(server.afk_timeout_minutes ?? 300)
  const [rulesChannelId, setRulesChannelId] = useState<string>(server.rules_channel_id ?? '')
  const [vanityUrl, setVanityUrl] = useState(server.vanity_url ?? '')
  const [explicitFilter, setExplicitFilter] = useState<string>(server.content_filter ?? 'none')
  const [serverCategory, setServerCategory] = useState<string>(server.server_category ?? '')
  const [iconPreview, setIconPreview] = useState<string | null>(server.icon ?? null)
  const bannerInputRef = useRef<HTMLInputElement>(null)
  const [newBotName, setNewBotName] = useState('')
  const [createdToken, setCreatedToken] = useState<{ name: string; token: string } | null>(null)
  const [copiedToken, setCopiedToken] = useState(false)
  const [emojiName, setEmojiName] = useState('')
  const iconInputRef = useRef<HTMLInputElement>(null)
  const emojiInputRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()

  const uploadBanner = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append('icon', file)
      const { data } = await api.post(`/servers/${server.id}/banner`, form)
      return data
    },
    onSuccess: (data) => {
      setBannerUrl(data.banner)
      qc.invalidateQueries({ queryKey: ['server', server.id] })
      toast.success(t('settings.profile.bannerUpdated'))
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('settings.profile.bannerError')),
  })

  const updateVerification = useMutation({
    mutationFn: () => api.patch(`/servers/${server.id}/verification`, {
      verification_enabled: verificationEnabled,
      verification_rules: verificationRules || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['server', server.id] })
      toast.success(t('srv.verificationUpdated'))
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('common.error')),
  })

  const update = useMutation({
    mutationFn: () => api.patch(`/servers/${server.id}`, {
      name,
      description,
      is_public: isPublic,
      // Chaîne vide et non `null` pour pouvoir vider : le serveur fait COALESCE.
      welcome_message: welcomeMessage,
      banner: bannerUrl,
      system_channel_id: systemChannelId || null,
      afk_channel_id: afkChannelId || null,
      afk_timeout: afkTimeout,
      rules_channel_id: rulesChannelId || null,
      vanity_url: vanityUrl.trim() || null,
      content_filter: explicitFilter,
      server_category: serverCategory || null,
      role_color_overrides_name: roleColorWins,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['server', server.id] })
      qc.invalidateQueries({ queryKey: ['servers'] })
      toast.success(t('srv.updated'))
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('common.error')),
  })

  const uploadIcon = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append('icon', file)
      const { data } = await api.post(`/servers/${server.id}/icon`, form)
      return data
    },
    onSuccess: (data) => {
      setIconPreview(data.icon)
      qc.invalidateQueries({ queryKey: ['server', server.id] })
      qc.invalidateQueries({ queryKey: ['servers'] })
      toast.success(t('srv.iconUpdated'))
    },
    onError: (e: any) => {
      // Le clic sur "Changer l'icône" affiche un aperçu local optimiste
      // (URL.createObjectURL) avant même la réponse serveur -- si l'upload
      // échoue, revenir à l'icône réellement enregistrée au lieu de laisser
      // l'aperçu d'un fichier jamais sauvegardé affiché comme si de rien n'était.
      setIconPreview(server.icon ?? null)
      toast.error(e.response?.data?.error ?? t('srv.uploadError'))
    },
  })


  // Emojis
  const { data: emojis = [] } = useQuery<any[]>({
    queryKey: ['custom_emojis', server.id],
    queryFn: () => api.get(`/servers/${server.id}/emojis`).then(r => r.data),
    enabled: tab === 'emojis',
  })

  const uploadEmoji = useMutation({
    mutationFn: async ({ name, file }: { name: string; file: File }) => {
      const fd = new FormData()
      fd.append('name', name)
      fd.append('file', file)
      return api.post(`/servers/${server.id}/emojis`, fd).then(r => r.data)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom_emojis', server.id] })
      setEmojiName('')
      toast.success(t('srv.emojiAdded'))
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('common.error')),
  })

  const deleteEmoji = useMutation({
    mutationFn: (emojiId: string) => api.delete(`/servers/${server.id}/emojis/${emojiId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom_emojis', server.id] }),
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('common.error')),
  })

  // Bots
  const { data: bots = [] } = useQuery<any[]>({
    queryKey: ['bots', server.id],
    queryFn: () => api.get(`/servers/${server.id}/bots`).then(r => r.data),
    enabled: tab === 'bots',
  })

  const createBot = useMutation({
    mutationFn: (name: string) => api.post(`/servers/${server.id}/bots`, { name }).then(r => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['bots', server.id] })
      setNewBotName('')
      setCreatedToken({ name: data.name, token: data.token })
      toast.success(t('srv.botCreated'))
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('common.error')),
  })

  const deleteBot = useMutation({
    mutationFn: (botId: string) => api.delete(`/servers/${server.id}/bots/${botId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots', server.id] }),
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('common.error')),
  })

  const regenToken = useMutation({
    mutationFn: (botId: string) => api.post(`/servers/${server.id}/bots/${botId}/token`).then(r => r.data),
    onSuccess: (data, botId) => {
      const bot = bots.find((b: any) => b.bot_user_id === botId)
      setCreatedToken({ name: bot?.name ?? 'Bot', token: data.token })
      toast.success(t('srv.tokenRegenerated'))
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('common.error')),
  })

  const copyToken = () => {
    if (!createdToken) return
    navigator.clipboard.writeText(createdToken.token)
    setCopiedToken(true)
    setTimeout(() => setCopiedToken(false), 2000)
  }

  // Canaux du serveur (pour Webhooks et AutoMod)
  const { data: channels = [] } = useQuery<any[]>({
    queryKey: ['server_channels', server.id],
    queryFn: () => api.get(`/servers/${server.id}/channels`).then(r => r.data),
  })

  // Libellés : clés srv.tab.<onglet> et srv.group.<groupe>.
  const tabGroups: { label: Key | null; tabs: { id: Tab; icon?: typeof Shield }[] }[] = [
    {
      label: null,
      tabs: [
        { id: 'general' },
        { id: 'appearance', icon: Palette }, { id: 'profile' },
        { id: 'e2e', icon: Lock },
      ],
    },
    {
      label: 'srv.group.community',
      tabs: [
        { id: 'roles', icon: Shield },
        { id: 'members', icon: Users },
        { id: 'tags', icon: Tag },
        ...(isAdmin || canSeeBans ? [{ id: 'bans' as Tab, icon: Ban }] : []),
        { id: 'emojis', icon: SmilePlus },
        { id: 'bots', icon: Bot },
        ...(isAdmin ? [{ id: 'webhooks' as Tab, icon: Link }] : []),
        { id: 'feeds', icon: Rss }, ...(canManageServer ? [{ id: 'invites' as Tab, icon: Ticket }] : []),
        ...(isAdmin || estProprietaire || canManageServer ? [{ id: 'discordSync' as Tab, icon: RefreshCw }] : []),
        ...(estProprietaire ? [{ id: 'onboarding' as Tab, icon: Sparkles }] : []),
        ...(isAdmin ? [{ id: 'community' as Tab, icon: Trophy }] : []),
      ],
    },
    {
      label: 'srv.group.moderation',
      tabs: [
        { id: 'events', icon: Calendar },
        ...(isAdmin ? [
          { id: 'audit' as Tab, icon: ScrollText }, { id: 'automod' as Tab, icon: Shield }, { id: 'stats' as Tab, icon: BarChart2 },
        ] : []),
      ],
    },
  ]

  const modal = (
    <div className="fixed inset-0 bg-black/80 flex z-[200]" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }} role="dialog" aria-modal="true" aria-labelledby="server-settings-modal-title">
      <div className="flex w-full h-full">
        {/* Sidebar nav — plein écran sur mobile, 220px sur desktop */}
        <div className={`bg-fc-channel flex-shrink-0 p-4 overflow-y-auto overscroll-contain w-full md:w-[220px] flex-col
          ${mobileShowContent ? 'hidden md:flex' : 'flex'}`}>
          <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2 px-2 truncate flex items-center justify-between">
            <span>{server.name}</span>
            <button onClick={onClose} aria-label={t('common.close')} className="text-fc-muted hover:text-white transition md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-fc-hover rounded">
              <X size={16} />
            </button>
          </div>
          {tabGroups.map((group, gi) => (
            <div key={gi} className={gi > 0 ? 'mt-4' : ''}>
              {group.label && (
                <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1 px-2">
                  {t(group.label)}
                </div>
              )}
              {group.tabs.map(tb => {
                const Icon = tb.icon
                return (
                  <button key={tb.id} onClick={() => { setTab(tb.id); setMobileShowContent(true) }}
                    className={`w-full text-left px-2 py-1.5 rounded text-sm transition mb-0.5 flex items-center gap-2
                      ${tab === tb.id ? 'bg-fc-hover text-white' : 'text-fc-muted hover:text-white hover:bg-fc-hover/50'}`}
                  >
                    {Icon && <Icon size={13} />}
                    {t(`srv.tab.${tb.id}`)}
                  </button>
                )
              })}
            </div>
          ))}
          <div className="mt-4 border-t border-fc-hover pt-4">
            <SaveAsTemplateButton serverId={server.id} serverName={server.name} />
          </div>
        </div>

        {/* Contenu — plein écran sur mobile quand sélectionné */}
        <div className={`flex-1 bg-fc-chat overflow-y-auto overscroll-contain ${!mobileShowContent ? 'hidden md:block' : 'block'}`}>
          <div className="max-w-2xl mx-auto p-4 md:p-8">
            <div className="flex items-center justify-between mb-6 md:mb-8">
              <div className="flex items-center gap-2">
                <button onClick={() => setMobileShowContent(false)} aria-label={t('common.back')} className="md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center text-fc-muted hover:text-white transition hover:bg-fc-hover rounded">
                  <X size={18} />
                </button>
                <h2 id="server-settings-modal-title" className="text-xl md:text-2xl font-bold text-white">{t('srv.title')}</h2>
              </div>
              <button onClick={onClose} aria-label={t('common.close')} className="hidden md:block text-fc-muted hover:text-white transition p-2 hover:bg-fc-hover rounded">
                <X size={20} />
              </button>
            </div>

            {/* ─── Général ─── */}
            {tab === 'general' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3">{t('srv.icon')}</label>
                  <div className="flex items-center gap-4">
                    <div className="w-20 h-20 rounded-full bg-fc-accent flex items-center justify-center font-bold text-2xl text-white overflow-hidden flex-shrink-0">
                      {iconPreview ? <img src={mediaUrl(iconPreview)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" /> : server.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <input ref={iconInputRef} type="file" accept="image/*" className="hidden"
                        onChange={e => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          uploadIcon.mutate(file)
                          setIconPreview(URL.createObjectURL(file))
                        }}
                      />
                      <button onClick={() => iconInputRef.current?.click()} disabled={uploadIcon.isPending}
                        className="flex items-center gap-2 px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition disabled:opacity-50"
                      >
                        <Upload size={14} />
                        {uploadIcon.isPending ? t('srv.uploading') : t('srv.changeIcon')}
                      </button>
                      <p className="text-xs text-fc-muted mt-1">{t('srv.iconFormats')}</p>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">{t('servers.create.name')}</label>
                  <input value={name} onChange={e => setName(e.target.value)} maxLength={100}
                    enterKeyHint="done"
                    autoCapitalize="sentences"
                    className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">{t('srv.description')}</label>
                  <textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={500} rows={3}
                    className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent resize-none text-sm"
                    placeholder={t('srv.descriptionPh')}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">
                    {t('srv.welcome')}
                    <span className="ml-1 normal-case font-normal text-fc-muted/60">({welcomeMessage.length}/500)</span>
                  </label>
                  <textarea value={welcomeMessage} onChange={e => setWelcomeMessage(e.target.value)} maxLength={500} rows={3}
                    className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent resize-none text-sm"
                    placeholder={t('srv.welcomePh')}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3">{t('srv.banner')}</label>
                  {bannerUrl && (
                    // Aperçu : la bannière entière, telle que les membres la verront.
                    <div className="mb-3 rounded-lg overflow-hidden bg-fc-channel">
                      <ProfileBanner src={bannerUrl} alt={t('srv.bannerAlt')} minHeight={72} maxHeight={260} />
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      value={bannerUrl}
                      onChange={e => setBannerUrl(e.target.value)}
                      placeholder={t('srv.bannerUrlPh')}
                      aria-label={t('srv.bannerUrlPh')}
                      enterKeyHint="done"
                      inputMode="url"
                      autoCapitalize="none"
                      autoComplete="off"
                      className="flex-1 px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
                    />
                    <input ref={bannerInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        if (file.size > 10 * 1024 * 1024) {
                          toast.error(t('srvLook.bannerTooBig'))
                          return
                        }
                        uploadBanner.mutate(file)
                      }}
                    />
                    <button
                      onClick={() => bannerInputRef.current?.click()}
                      disabled={uploadBanner.isPending}
                      className="flex items-center gap-2 px-3 py-2 bg-fc-channel hover:bg-fc-hover text-fc-muted hover:text-white rounded text-sm transition disabled:opacity-50"
                      title={t('srv.uploadImage')}
                      aria-label={t('srv.uploadImage')}
                    >
                      <Image size={14} />
                    </button>
                  </div>
                  <p className="text-xs text-fc-muted mt-1">{t('srvLook.bannerFormats')}</p>
                </div>

                <div className="flex items-center justify-between p-4 bg-fc-channel rounded-lg">
                  <div>
                    <div className="font-medium text-white text-sm">{t('srv.public')}</div>
                    <div className="text-xs text-fc-muted">{t('srv.publicDesc')}</div>
                  </div>
                  <button onClick={() => setIsPublic(!isPublic)} role="switch" aria-checked={isPublic} aria-label={t('srv.public')}
                    className={`w-11 h-6 rounded-full transition relative ${isPublic ? 'bg-fc-green' : 'bg-fc-muted'}`}
                  >
                    <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${isPublic ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>

                <div className="flex items-center justify-between gap-3 p-4 bg-fc-channel rounded-lg">
                  <div>
                    <div className="font-medium text-white text-sm">{t('srv.roleColorWins')}</div>
                    <div className="text-xs text-fc-muted">{t('srv.roleColorWinsDesc')}</div>
                  </div>
                  <button onClick={() => setRoleColorWins(!roleColorWins)} role="switch" aria-checked={roleColorWins} aria-label={t('srv.roleColorWins')}
                    className={`w-11 h-6 flex-shrink-0 rounded-full transition relative ${roleColorWins ? 'bg-fc-green' : 'bg-fc-muted'}`}
                  >
                    <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${roleColorWins ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">{t('createChannel.category')}</label>
                  <p className="text-xs text-fc-muted mb-2">{t('srv.categoryDesc')}</p>
                  <select value={serverCategory} onChange={e => setServerCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none text-sm">
                    <option value="">{t('settings.cosmetics.noneF')}</option>
                    <option value="gaming">Gaming</option>
                    <option value="community">{t('tpl.community')}</option>
                    <option value="tech">Tech</option>
                    <option value="music">{t('tpl.music')}</option>
                    <option value="education">{t('tpl.education')}</option>
                    <option value="arts">Arts</option>
                    <option value="18plus">18+</option>
                  </select>
                </div>

                {/* Canaux système */}
                <div className="border-t border-fc-hover pt-4 space-y-4">
                  <h3 className="text-sm font-semibold text-white">{t('srv.systemChannels')}</h3>
                  <div>
                    <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">{t('srv.systemChannel')}</label>
                    <p className="text-xs text-fc-muted mb-2">{t('srv.systemChannelDesc')}</p>
                    <select value={systemChannelId} onChange={e => setSystemChannelId(e.target.value)}
                      className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none text-sm">
                      <option value="">{t('settings.access.none')}</option>
                      {channels.filter((c: any) => c.type === 'text').map((c: any) => (
                        <option key={c.id} value={c.id}>#{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <BirthdayChannelSetting serverId={server.id} channels={channels} />
                  <div>
                    <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">{t('srv.rulesChannel')}</label>
                    <p className="text-xs text-fc-muted mb-2">{t('srv.rulesChannelDesc')}</p>
                    <select value={rulesChannelId} onChange={e => setRulesChannelId(e.target.value)}
                      className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none text-sm">
                      <option value="">{t('settings.access.none')}</option>
                      {channels.filter((c: any) => c.type === 'text').map((c: any) => (
                        <option key={c.id} value={c.id}>#{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">{t('srv.afkChannel')}</label>
                    <select value={afkChannelId} onChange={e => setAfkChannelId(e.target.value)}
                      className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none text-sm">
                      <option value="">{t('settings.access.none')}</option>
                      {channels.filter((c: any) => c.type === 'voice').map((c: any) => (
                        <option key={c.id} value={c.id}>🔊 {c.name}</option>
                      ))}
                    </select>
                  </div>
                  {afkChannelId && (
                    <div>
                      <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">
                        {t('srv.afkTimeout')} — {afkTimeout >= 3600 ? `${afkTimeout/3600}h` : `${afkTimeout/60} min`}
                      </label>
                      <select value={afkTimeout} onChange={e => setAfkTimeout(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none text-sm">
                        {[60, 120, 300, 600, 900, 1800, 3600].map(s => (
                          <option key={s} value={s}>{s >= 3600 ? `${s/3600}h` : `${s/60} min`}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* Modération */}
                <div className="border-t border-fc-hover pt-4 space-y-4">
                  <h3 className="text-sm font-semibold text-white">{t('srv.group.moderation')}</h3>
                  <div>
                    <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">{t('settings.privacy.explicit')}</label>
                    <select value={explicitFilter} onChange={e => setExplicitFilter(e.target.value)}
                      className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none text-sm">
                      <option value="none">{t('settings.privacy.off')}</option>
                      <option value="no_role">{t('settings.privacy.noRoles')}</option>
                      <option value="all">{t('srv.allMembers')}</option>
                    </select>
                  </div>
                </div>

                {/* Vanity URL */}
                <div className="border-t border-fc-hover pt-4">
                  <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">{t('srv.vanity')}</label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-xs text-fc-muted">forgechat/</span>
                    <input value={vanityUrl} onChange={e => setVanityUrl(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                      maxLength={30}
                      placeholder={t('srv.vanityPh')}
                      aria-label={t('srv.vanity')}
                      enterKeyHint="done"
                      autoCapitalize="none"
                      autoComplete="off"
                      className="w-full pl-24 pr-3 py-2 bg-fc-input rounded text-white outline-none text-sm focus:ring-2 focus:ring-fc-accent"
                    />
                  </div>
                  <p className="text-xs text-fc-muted mt-1">{t('srv.vanityHint')}</p>
                </div>

                <BoostSection server={server} />

                <TransferOwnershipSection serverId={server.id} ownerId={server.owner_id ?? ''} />

                {estProprietaire && <div className="p-4 bg-fc-channel/50 rounded-lg border border-fc-red/40">
                  <div className="text-xs font-semibold text-fc-red uppercase tracking-wide mb-2">{t('srv.danger')}</div>
                  <p className="text-sm text-fc-muted mb-3">
                    {t('srv.dangerDesc')}
                  </p>
                  <button onClick={() => setShowDelete(true)}
                    className="px-4 py-2 rounded text-sm font-medium bg-fc-red text-white hover:bg-red-600 transition flex items-center gap-2"
                  >
                    <Trash2 size={14} /> {t('srv.delete')}
                  </button>
                  {showDelete && <DeleteServerModal server={server} onClose={() => setShowDelete(false)} />}
                </div>}

                <button onClick={() => update.mutate()} disabled={update.isPending}
                  className="px-5 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded font-medium text-sm transition disabled:opacity-50"
                >
                  {update.isPending ? t('common.saving') : t('srv.saveChanges')}
                </button>

                {/* ─── Verification Gate ─── */}
                <div className="border-t border-fc-hover pt-6 mt-2">
                  <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
                    <Shield size={16} className="text-fc-accent" />
                    {t('srv.verification')}
                  </h3>

                  <div className="flex items-center justify-between p-4 bg-fc-channel rounded-lg mb-4">
                    <div>
                      <div className="font-medium text-white text-sm">{t('srv.enableVerification')}</div>
                      <div className="text-xs text-fc-muted">{t('srv.enableVerificationDesc')}</div>
                    </div>
                    <button onClick={() => setVerificationEnabled(!verificationEnabled)} role="switch" aria-checked={verificationEnabled} aria-label={t('srv.enableVerification')}
                      className={`w-11 h-6 rounded-full transition relative ${verificationEnabled ? 'bg-fc-green' : 'bg-fc-muted'}`}
                    >
                      <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${verificationEnabled ? 'left-6' : 'left-1'}`} />
                    </button>
                  </div>

                  {verificationEnabled && (
                    <div className="mb-4">
                      <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">
                        {t('srv.rules')}
                        <span className="ml-1 normal-case font-normal text-fc-muted/60">({verificationRules.length}/2000)</span>
                      </label>
                      <textarea
                        value={verificationRules}
                        onChange={e => setVerificationRules(e.target.value)}
                        maxLength={2000}
                        rows={6}
                        placeholder={t('srv.rulesPh')}
                        className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent resize-none text-sm"
                      />
                    </div>
                  )}

                  <button
                    onClick={() => updateVerification.mutate()}
                    disabled={updateVerification.isPending}
                    className="px-5 py-2 bg-fc-channel hover:bg-fc-hover border border-fc-hover text-white rounded font-medium text-sm transition disabled:opacity-50"
                  >
                    {updateVerification.isPending ? t('common.saving') : t('srv.saveVerification')}
                  </button>
                </div>
              </div>
            )}

            {/* ─── Emojis ─── */}
            {tab === 'emojis' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
                    <SmilePlus size={18} className="text-fc-accent" />
                    {t('srv.emojis')}
                  </h3>
                  <p className="text-sm text-fc-muted mb-4">
                    {t('srv.emojisDesc')}
                  </p>

                  {/* Upload form */}
                  <div className="flex gap-2 mb-6">
                    <input value={emojiName} onChange={e => setEmojiName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                      placeholder={t('srv.emojiNamePh')}
                      aria-label={t('srv.emojiNamePh')}
                      maxLength={32}
                      enterKeyHint="done"
                      autoCapitalize="none"
                      className="flex-1 px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
                    />
                    <button
                      onClick={() => emojiInputRef.current?.click()}
                      disabled={!emojiName.trim() || uploadEmoji.isPending}
                      className="flex items-center gap-2 px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition disabled:opacity-50"
                    >
                      <Plus size={14} />
                      {uploadEmoji.isPending ? t('srv.uploading') : t('chset.add')}
                    </button>
                    <input ref={emojiInputRef} type="file" accept="image/*" className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0]
                        if (!file || !emojiName.trim()) return
                        uploadEmoji.mutate({ name: emojiName.trim(), file })
                        e.target.value = ''
                      }}
                    />
                  </div>

                  {/* Liste emojis */}
                  {emojis.length === 0 ? (
                    <div className="text-center text-fc-muted py-10 text-sm">
                      {t('srv.noEmoji')}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {emojis.map((emoji: any) => (
                        <div key={emoji.id} className="flex items-center gap-3 p-3 bg-fc-channel rounded-lg">
                          <img src={mediaUrl(emoji.url)} alt={emoji.name} loading="lazy" decoding="async" className="w-8 h-8 object-contain rounded" />
                          <div className="flex-1">
                            <div className="text-white text-sm font-medium">:{emoji.name}:</div>
                          </div>
                          <button onClick={() => deleteEmoji.mutate(emoji.id)}
                            className="p-1.5 text-fc-muted hover:text-red-400 hover:bg-fc-hover rounded transition"
                            title={t('common.delete')}
                            aria-label={t('common.delete')}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ─── Bots ─── */}
            {tab === 'bots' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
                    <Bot size={18} className="text-fc-accent" />
                    {t('srv.bots')}
                  </h3>
                  <p className="text-sm text-fc-muted mb-4">
                    {t('srv.botsDesc')}<br />
                    {t('srv.endpoint')} <code className="bg-fc-input px-1 rounded text-xs text-fc-accent">POST /api/bot/messages</code> {t('srv.with')} <code className="bg-fc-input px-1 rounded text-xs">Authorization: Bot &lt;token&gt;</code>
                  </p>

                  {/* Créer un bot */}
                  <div className="flex gap-2 mb-6">
                    <input value={newBotName} onChange={e => setNewBotName(e.target.value)}
                      placeholder={t('srv.botName')}
                      aria-label={t('srv.botName')}
                      maxLength={32}
                      enterKeyHint="done"
                      autoCapitalize="sentences"
                      className="flex-1 px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
                      onKeyDown={e => { if (e.key === 'Enter' && newBotName.trim()) createBot.mutate(newBotName.trim()) }}
                    />
                    <button
                      onClick={() => { if (newBotName.trim()) createBot.mutate(newBotName.trim()) }}
                      disabled={!newBotName.trim() || createBot.isPending}
                      className="flex items-center gap-2 px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition disabled:opacity-50"
                    >
                      <Plus size={14} />
                      {createBot.isPending ? t('common.creating') : t('srv.createBot')}
                    </button>
                  </div>

                  {/* Token créé — à copier maintenant */}
                  {createdToken && (
                    <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                      <div className="text-yellow-400 font-semibold text-sm mb-2">
                        {t('srv.tokenWarning', { name: createdToken.name })}
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 bg-fc-input px-3 py-2 rounded text-sm text-white font-mono break-all">
                          {createdToken.token}
                        </code>
                        <button onClick={copyToken} aria-label={t('srv.copyToken')}
                          className={`p-2 rounded transition flex-shrink-0 ${copiedToken ? 'bg-fc-green text-white' : 'bg-fc-hover text-fc-muted hover:text-white'}`}
                        >
                          {copiedToken ? <Check size={16} /> : <Copy size={16} />}
                        </button>
                      </div>
                      <button onClick={() => setCreatedToken(null)} className="text-xs text-fc-muted mt-2 hover:text-white transition">
                        {t('common.close')}
                      </button>
                    </div>
                  )}

                  {/* Liste bots */}
                  {bots.length === 0 ? (
                    <div className="text-center text-fc-muted py-10 text-sm">
                      {t('srv.noBot')}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {bots.map((bot: any) => (
                        <div key={bot.bot_user_id} className="flex items-center gap-3 p-3 bg-fc-channel rounded-lg">
                          <div className="w-10 h-10 rounded-full bg-indigo-500/30 flex items-center justify-center flex-shrink-0">
                            {bot.avatar
                              ? <img src={mediaUrl(bot.avatar)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover rounded-full" />
                              : <Bot size={18} className="text-indigo-400" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-white text-sm font-medium flex items-center gap-1.5">
                              {bot.name}
                              <span className="text-xs bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded font-medium">BOT</span>
                            </div>
                            <div className="text-xs text-fc-muted">@{bot.username}</div>
                          </div>
                          <button onClick={() => regenToken.mutate(bot.bot_user_id)}
                            className="p-1.5 text-fc-muted hover:text-white hover:bg-fc-hover rounded transition"
                            title={t('srv.regenToken')}
                            aria-label={t('srv.regenToken')}
                          >
                            <RefreshCw size={14} />
                          </button>
                          <button onClick={() => deleteBot.mutate(bot.bot_user_id)}
                            className="p-1.5 text-fc-muted hover:text-red-400 hover:bg-fc-hover rounded transition"
                            title={t('srv.deleteBot')}
                            aria-label={t('srv.deleteBot')}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === 'appearance' && <ServerAppearanceTab serverId={server.id} canEdit={estProprietaire} />}
            {tab === 'profile' && <MyServerProfileTab serverId={server.id} />}
            {tab === 'e2e' && <ServerKeySettings serverId={server.id} serverName={server.name} isOwner={estProprietaire} />}
            {tab === 'events'  && <ServerEventsPage serverId={server.id} />}
            {tab === 'stats'   && <StatsTab serverId={server.id} />}
            {tab === 'invites' && <InviteTrackingTab serverId={server.id} />}
            {tab === 'onboarding' && <OnboardingTab serverId={server.id} channels={channels} />}
            {tab === 'community' && <CommunitySettings server={server} channels={channels} />}
            {tab === 'roles'   && <RolesTab serverId={server.id} />}
            {tab === 'members' && <MembersTab serverId={server.id} />}
            {tab === 'bans'    && <BansTab serverId={server.id} />}
            {tab === 'tags'    && <TagsTab serverId={server.id} />}
            {tab === 'webhooks' && <WebhooksTab server={server} channels={channels} />}
            {tab === 'feeds'   && <FeedsTab serverId={server.id} channels={channels} />}
            {tab === 'discordSync' && <DiscordSyncTab serverId={server.id} />}
            {tab === 'audit'   && <AuditLogTab server={server} />}
            {tab === 'automod' && <AutoModTab server={server} channels={channels} />}
          </div>
        </div>
      </div>
    </div>
  )
  return createPortal(modal, document.body)
}
