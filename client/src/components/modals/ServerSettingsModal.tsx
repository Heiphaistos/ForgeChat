import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Trash2, Upload, SmilePlus, Bot, Plus, RefreshCw, Copy, Check, Shield, Users, Ban, Tag, Link, ScrollText, Rss, BarChart2, Image, Calendar } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import api from '../../api/client'
import toast from 'react-hot-toast'
import RolesTab from './RolesTab'
import MembersTab from './MembersTab'
import BansTab from './BansTab'
import TagsTab from './TagsTab'
import WebhooksTab from './WebhooksTab'
import AuditLogTab from './AuditLogTab'
import AutoModTab from './AutoModTab'
import FeedsTab from './FeedsTab'
import StatsTab from './StatsTab'
import ServerEventsPage from '../../pages/ServerEventsPage'

interface Server {
  id: string
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
  boost_level?: number
  boost_count?: number
  raid_protection?: boolean
  require_2fa_for_moderation?: boolean
  server_locale?: string
  max_video_channel_users?: number
}

interface Props {
  server: Server
  onClose: () => void
  isAdmin?: boolean
}

type Tab = 'general' | 'roles' | 'members' | 'bans' | 'tags' | 'emojis' | 'bots' | 'webhooks' | 'audit' | 'automod' | 'feeds' | 'stats' | 'events'

function BoostSection({ server }: { server: any }) {
  const LEVELS = [
    { level: 1, threshold: 2, label: 'Niveau 1', color: 'from-indigo-500 to-purple-500' },
    { level: 2, threshold: 7, label: 'Niveau 2', color: 'from-purple-500 to-fuchsia-500' },
    { level: 3, threshold: 14, label: 'Niveau 3', color: 'from-amber-500 to-yellow-400' },
  ]
  const currentLevel = server?.boost_level ?? 0
  const count = server?.boost_count ?? 0
  const next = LEVELS.find(l => l.level === currentLevel + 1)
  const progress = next ? Math.min(100, (count / next.threshold) * 100) : 100

  return (
    <div className="mt-4 p-4 bg-fc-channel rounded-xl">
      <h3 className="text-sm font-semibold text-white mb-3">⚡ Boosts du serveur</h3>
      <div className="flex items-center gap-3 mb-3">
        <span className="text-2xl font-bold text-white">{count}</span>
        <span className="text-fc-muted text-sm">boost{count !== 1 ? 's' : ''} actif{count !== 1 ? 's' : ''}</span>
        {currentLevel > 0 && (
          <span className="ml-auto px-2 py-0.5 bg-fc-accent/20 text-fc-accent text-xs rounded-full">
            Niveau {currentLevel}
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
          <p className="text-xs text-fc-muted">{count}/{next.threshold} pour {next.label}</p>
        </>
      )}
      <button
        className="mt-3 w-full py-2 bg-fc-accent/10 hover:bg-fc-accent/20 text-fc-accent text-sm rounded-lg transition"
        onClick={() => toast('Fonctionnalité bientôt disponible !')}
      >
        ⚡ Booster ce serveur
      </button>
    </div>
  )
}

export default function ServerSettingsModal({ server, onClose, isAdmin = false }: Props) {
  const [tab, setTab] = useState<Tab>('general')
  const [name, setName] = useState(server.name)
  const [description, setDescription] = useState(server.description ?? '')
  const [welcomeMessage, setWelcomeMessage] = useState(server.welcome_message ?? '')
  const [bannerUrl, setBannerUrl] = useState(server.banner ?? '')
  const [isPublic, setIsPublic] = useState(server.is_public)
  const [verificationEnabled, setVerificationEnabled] = useState(server.verification_enabled ?? false)
  const [verificationRules, setVerificationRules] = useState(server.verification_rules ?? '')
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [systemChannelId, setSystemChannelId] = useState<string>(server.system_channel_id ?? '')
  const [afkChannelId, setAfkChannelId] = useState<string>(server.afk_channel_id ?? '')
  const [afkTimeout, setAfkTimeout] = useState(server.afk_timeout_minutes ?? 300)
  const [rulesChannelId, setRulesChannelId] = useState<string>(server.rules_channel_id ?? '')
  const [vanityUrl, setVanityUrl] = useState(server.vanity_url ?? '')
  const [explicitFilter, setExplicitFilter] = useState<string>(server.content_filter ?? 'none')
  const [iconPreview, setIconPreview] = useState<string | null>(server.icon ?? null)
  const bannerInputRef = useRef<HTMLInputElement>(null)
  const [newBotName, setNewBotName] = useState('')
  const [createdToken, setCreatedToken] = useState<{ name: string; token: string } | null>(null)
  const [copiedToken, setCopiedToken] = useState(false)
  const [emojiName, setEmojiName] = useState('')
  const iconInputRef = useRef<HTMLInputElement>(null)
  const emojiInputRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()
  const nav = useNavigate()

  const uploadBanner = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append('icon', file)
      const { data } = await api.post(`/servers/${server.id}/icon`, form)
      return data
    },
    onSuccess: (data) => {
      setBannerUrl(data.icon)
      qc.invalidateQueries({ queryKey: ['server', server.id] })
      toast.success('Bannière mise à jour')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur upload bannière'),
  })

  const updateVerification = useMutation({
    mutationFn: () => api.patch(`/servers/${server.id}/verification`, {
      verification_enabled: verificationEnabled,
      verification_rules: verificationRules || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['server', server.id] })
      toast.success('Vérification mise à jour')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const update = useMutation({
    mutationFn: () => api.patch(`/servers/${server.id}`, {
      name,
      description,
      is_public: isPublic,
      welcome_message: welcomeMessage || null,
      banner: bannerUrl || null,
      system_channel_id: systemChannelId || null,
      afk_channel_id: afkChannelId || null,
      afk_timeout: afkTimeout,
      rules_channel_id: rulesChannelId || null,
      vanity_url: vanityUrl.trim() || null,
      content_filter: explicitFilter,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['server', server.id] })
      qc.invalidateQueries({ queryKey: ['servers'] })
      toast.success('Serveur mis à jour')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
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
      toast.success('Icône mise à jour')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur upload'),
  })

  const deleteServer = useMutation({
    mutationFn: () => api.delete(`/servers/${server.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['servers'] })
      nav('/')
      toast.success('Serveur supprimé')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
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
      toast.success('Emoji ajouté')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const deleteEmoji = useMutation({
    mutationFn: (emojiId: string) => api.delete(`/servers/${server.id}/emojis/${emojiId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom_emojis', server.id] }),
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
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
      toast.success('Bot créé')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const deleteBot = useMutation({
    mutationFn: (botId: string) => api.delete(`/servers/${server.id}/bots/${botId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots', server.id] }),
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const regenToken = useMutation({
    mutationFn: (botId: string) => api.post(`/servers/${server.id}/bots/${botId}/token`).then(r => r.data),
    onSuccess: (data, botId) => {
      const bot = bots.find((b: any) => b.bot_user_id === botId)
      setCreatedToken({ name: bot?.name ?? 'Bot', token: data.token })
      toast.success('Token régénéré')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
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

  const tabGroups = [
    {
      label: null,
      tabs: [
        { id: 'general' as Tab, label: 'Général' },
      ],
    },
    {
      label: 'Communauté',
      tabs: [
        { id: 'roles'    as Tab, label: 'Rôles',     icon: Shield },
        { id: 'members'  as Tab, label: 'Membres',   icon: Users },
        { id: 'tags'     as Tab, label: 'Tags clan',  icon: Tag },
        ...(isAdmin ? [{ id: 'bans' as Tab, label: 'Bans', icon: Ban }] : []),
        { id: 'emojis'   as Tab, label: 'Emojis',    icon: SmilePlus },
        { id: 'bots'     as Tab, label: 'Bots',      icon: Bot },
        ...(isAdmin ? [{ id: 'webhooks' as Tab, label: 'Webhooks', icon: Link }] : []),
        { id: 'feeds'    as Tab, label: 'Flux RSS',  icon: Rss },
      ],
    },
    {
      label: 'Modération',
      tabs: [
        { id: 'events'  as Tab, label: 'Événements', icon: Calendar },
        ...(isAdmin ? [
          { id: 'audit'   as Tab, label: 'Audit Log',    icon: ScrollText },
          { id: 'automod' as Tab, label: 'AutoMod',      icon: Shield },
          { id: 'stats'   as Tab, label: 'Statistiques', icon: BarChart2 },
        ] : []),
      ],
    },
  ]

  const modal = (
    <div className="fixed inset-0 bg-black/80 flex z-[200]" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}>
      <div className="flex w-full h-full">
        {/* Sidebar */}
        <div className="w-[220px] bg-fc-channel flex-shrink-0 p-4 overflow-y-auto">
          <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2 px-2 truncate">
            {server.name}
          </div>
          {tabGroups.map((group, gi) => (
            <div key={gi} className={gi > 0 ? 'mt-4' : ''}>
              {group.label && (
                <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1 px-2">
                  {group.label}
                </div>
              )}
              {group.tabs.map(t => {
                const Icon = (t as any).icon
                return (
                  <button key={t.id} onClick={() => setTab(t.id)}
                    className={`w-full text-left px-2 py-1.5 rounded text-sm transition mb-0.5 flex items-center gap-2
                      ${tab === t.id ? 'bg-fc-hover text-white' : 'text-fc-muted hover:text-white hover:bg-fc-hover/50'}`}
                  >
                    {Icon && <Icon size={13} />}
                    {t.label}
                  </button>
                )
              })}
            </div>
          ))}
          <div className="mt-4 border-t border-fc-hover pt-4">
            <button onClick={() => deleteServer.mutate()} disabled={deleteConfirm !== server.name}
              className="w-full text-left px-2 py-1.5 rounded text-sm text-fc-red hover:bg-fc-red/10 transition flex items-center gap-2 disabled:opacity-40"
            >
              <Trash2 size={14} /> Supprimer le serveur
            </button>
          </div>
        </div>

        {/* Contenu */}
        <div className="flex-1 bg-fc-chat overflow-y-auto">
          <div className="max-w-2xl mx-auto p-8">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-2xl font-bold text-white">Paramètres du serveur</h2>
              <button onClick={onClose} className="text-fc-muted hover:text-white transition p-2 hover:bg-fc-hover rounded">
                <X size={20} />
              </button>
            </div>

            {/* ─── Général ─── */}
            {tab === 'general' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3">Icône du serveur</label>
                  <div className="flex items-center gap-4">
                    <div className="w-20 h-20 rounded-full bg-fc-accent flex items-center justify-center font-bold text-2xl text-white overflow-hidden flex-shrink-0">
                      {iconPreview ? <img src={iconPreview} alt="" className="w-full h-full object-cover" /> : server.name.charAt(0).toUpperCase()}
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
                        {uploadIcon.isPending ? 'Upload...' : "Changer l'icône"}
                      </button>
                      <p className="text-xs text-fc-muted mt-1">PNG, JPG, GIF, WEBP · max 8 MB</p>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">Nom du serveur</label>
                  <input value={name} onChange={e => setName(e.target.value)} maxLength={100}
                    className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">Description</label>
                  <textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={500} rows={3}
                    className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent resize-none text-sm"
                    placeholder="Décrivez votre serveur..."
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">
                    Message de bienvenue
                    <span className="ml-1 normal-case font-normal text-fc-muted/60">({welcomeMessage.length}/500)</span>
                  </label>
                  <textarea value={welcomeMessage} onChange={e => setWelcomeMessage(e.target.value)} maxLength={500} rows={3}
                    className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent resize-none text-sm"
                    placeholder="Message affiché aux membres sur l'écran de bienvenue..."
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3">Bannière du serveur</label>
                  {bannerUrl && (
                    <div className="mb-3 rounded-lg overflow-hidden h-[120px] bg-fc-channel">
                      <img src={bannerUrl} alt="bannière" className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      value={bannerUrl}
                      onChange={e => setBannerUrl(e.target.value)}
                      placeholder="https://... (URL de l'image)"
                      className="flex-1 px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
                    />
                    <input ref={bannerInputRef} type="file" accept="image/*" className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        if (file.size > 2 * 1024 * 1024) {
                          toast.error('Bannière max 2 MB')
                          return
                        }
                        uploadBanner.mutate(file)
                      }}
                    />
                    <button
                      onClick={() => bannerInputRef.current?.click()}
                      disabled={uploadBanner.isPending}
                      className="flex items-center gap-2 px-3 py-2 bg-fc-channel hover:bg-fc-hover text-fc-muted hover:text-white rounded text-sm transition disabled:opacity-50"
                      title="Uploader une image"
                    >
                      <Image size={14} />
                    </button>
                  </div>
                  <p className="text-xs text-fc-muted mt-1">URL ou upload · PNG, JPG, GIF · max 2 MB</p>
                </div>

                <div className="flex items-center justify-between p-4 bg-fc-channel rounded-lg">
                  <div>
                    <div className="font-medium text-white text-sm">Serveur public</div>
                    <div className="text-xs text-fc-muted">Visible dans la liste des serveurs publics</div>
                  </div>
                  <button onClick={() => setIsPublic(!isPublic)}
                    className={`w-11 h-6 rounded-full transition relative ${isPublic ? 'bg-fc-green' : 'bg-fc-muted'}`}
                  >
                    <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${isPublic ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>

                {/* Canaux système */}
                <div className="border-t border-fc-hover pt-4 space-y-4">
                  <h3 className="text-sm font-semibold text-white">Canaux système</h3>
                  <div>
                    <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">Canal système</label>
                    <p className="text-xs text-fc-muted mb-2">Messages de bienvenue et de boost de serveur</p>
                    <select value={systemChannelId} onChange={e => setSystemChannelId(e.target.value)}
                      className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none text-sm">
                      <option value="">Aucun</option>
                      {channels.filter((c: any) => c.type === 'text').map((c: any) => (
                        <option key={c.id} value={c.id}>#{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">Canal des règles</label>
                    <p className="text-xs text-fc-muted mb-2">Affiché sur l'écran de vérification des membres</p>
                    <select value={rulesChannelId} onChange={e => setRulesChannelId(e.target.value)}
                      className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none text-sm">
                      <option value="">Aucun</option>
                      {channels.filter((c: any) => c.type === 'text').map((c: any) => (
                        <option key={c.id} value={c.id}>#{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">Canal AFK (inactif)</label>
                    <select value={afkChannelId} onChange={e => setAfkChannelId(e.target.value)}
                      className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none text-sm">
                      <option value="">Aucun</option>
                      {channels.filter((c: any) => c.type === 'voice').map((c: any) => (
                        <option key={c.id} value={c.id}>🔊 {c.name}</option>
                      ))}
                    </select>
                  </div>
                  {afkChannelId && (
                    <div>
                      <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">
                        Délai AFK — {afkTimeout >= 3600 ? `${afkTimeout/3600}h` : `${afkTimeout/60} min`}
                      </label>
                      <select value={afkTimeout} onChange={e => setAfkTimeout(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none text-sm">
                        {[60, 120, 300, 600, 900, 1800, 3600].map(t => (
                          <option key={t} value={t}>{t >= 3600 ? `${t/3600}h` : `${t/60} min`}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* Modération */}
                <div className="border-t border-fc-hover pt-4 space-y-4">
                  <h3 className="text-sm font-semibold text-white">Modération</h3>
                  <div>
                    <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">Filtre de contenu explicite</label>
                    <select value={explicitFilter} onChange={e => setExplicitFilter(e.target.value)}
                      className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none text-sm">
                      <option value="none">Désactivé</option>
                      <option value="no_role">Membres sans rôles</option>
                      <option value="all">Tous les membres</option>
                    </select>
                  </div>
                </div>

                {/* Vanity URL */}
                <div className="border-t border-fc-hover pt-4">
                  <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">Lien d'invitation personnalisé</label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-xs text-fc-muted">forgechat/</span>
                    <input value={vanityUrl} onChange={e => setVanityUrl(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                      maxLength={30}
                      placeholder="mon-serveur"
                      className="w-full pl-24 pr-3 py-2 bg-fc-input rounded text-white outline-none text-sm focus:ring-2 focus:ring-fc-accent"
                    />
                  </div>
                  <p className="text-xs text-fc-muted mt-1">Uniquement des lettres minuscules, chiffres et tirets</p>
                </div>

                <BoostSection server={server} />

                <div className="p-4 bg-fc-channel/50 rounded-lg border border-fc-hover">
                  <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">Zone de danger</div>
                  <p className="text-sm text-fc-muted mb-3">
                    Tape le nom du serveur pour le supprimer : <span className="text-white font-mono">{server.name}</span>
                  </p>
                  <input value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)}
                    placeholder={server.name}
                    className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-red text-sm"
                  />
                </div>

                <button onClick={() => update.mutate()} disabled={update.isPending}
                  className="px-5 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded font-medium text-sm transition disabled:opacity-50"
                >
                  {update.isPending ? 'Sauvegarde...' : 'Sauvegarder les modifications'}
                </button>

                {/* ─── Verification Gate ─── */}
                <div className="border-t border-fc-hover pt-6 mt-2">
                  <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
                    <Shield size={16} className="text-fc-accent" />
                    Vérification requise
                  </h3>

                  <div className="flex items-center justify-between p-4 bg-fc-channel rounded-lg mb-4">
                    <div>
                      <div className="font-medium text-white text-sm">Activer la vérification</div>
                      <div className="text-xs text-fc-muted">Les membres doivent accepter les règles avant d'accéder aux canaux</div>
                    </div>
                    <button onClick={() => setVerificationEnabled(!verificationEnabled)}
                      className={`w-11 h-6 rounded-full transition relative ${verificationEnabled ? 'bg-fc-green' : 'bg-fc-muted'}`}
                    >
                      <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${verificationEnabled ? 'left-6' : 'left-1'}`} />
                    </button>
                  </div>

                  {verificationEnabled && (
                    <div className="mb-4">
                      <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">
                        Règles du serveur
                        <span className="ml-1 normal-case font-normal text-fc-muted/60">({verificationRules.length}/2000)</span>
                      </label>
                      <textarea
                        value={verificationRules}
                        onChange={e => setVerificationRules(e.target.value)}
                        maxLength={2000}
                        rows={6}
                        placeholder="Écris les règles que les membres devront accepter..."
                        className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent resize-none text-sm"
                      />
                    </div>
                  )}

                  <button
                    onClick={() => updateVerification.mutate()}
                    disabled={updateVerification.isPending}
                    className="px-5 py-2 bg-fc-channel hover:bg-fc-hover border border-fc-hover text-white rounded font-medium text-sm transition disabled:opacity-50"
                  >
                    {updateVerification.isPending ? 'Sauvegarde...' : 'Sauvegarder la vérification'}
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
                    Emojis personnalisés
                  </h3>
                  <p className="text-sm text-fc-muted mb-4">
                    Ajoutez des emojis propres à votre serveur. Format : PNG/GIF · max 256 KB · nom alphanumérique.
                  </p>

                  {/* Upload form */}
                  <div className="flex gap-2 mb-6">
                    <input value={emojiName} onChange={e => setEmojiName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                      placeholder="nom_emoji (alphanum + _)"
                      maxLength={32}
                      className="flex-1 px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
                    />
                    <button
                      onClick={() => emojiInputRef.current?.click()}
                      disabled={!emojiName.trim() || uploadEmoji.isPending}
                      className="flex items-center gap-2 px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition disabled:opacity-50"
                    >
                      <Plus size={14} />
                      {uploadEmoji.isPending ? 'Upload...' : 'Ajouter'}
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
                      Aucun emoji personnalisé pour ce serveur.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {emojis.map((emoji: any) => (
                        <div key={emoji.id} className="flex items-center gap-3 p-3 bg-fc-channel rounded-lg">
                          <img src={emoji.url} alt={emoji.name} className="w-8 h-8 object-contain rounded" />
                          <div className="flex-1">
                            <div className="text-white text-sm font-medium">:{emoji.name}:</div>
                          </div>
                          <button onClick={() => deleteEmoji.mutate(emoji.id)}
                            className="p-1.5 text-fc-muted hover:text-red-400 hover:bg-fc-hover rounded transition"
                            title="Supprimer"
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
                    Bots du serveur
                  </h3>
                  <p className="text-sm text-fc-muted mb-4">
                    Créez des bots qui peuvent envoyer des messages via API.<br />
                    Endpoint : <code className="bg-fc-input px-1 rounded text-xs text-fc-accent">POST /api/bot/messages</code> avec <code className="bg-fc-input px-1 rounded text-xs">Authorization: Bot &lt;token&gt;</code>
                  </p>

                  {/* Créer un bot */}
                  <div className="flex gap-2 mb-6">
                    <input value={newBotName} onChange={e => setNewBotName(e.target.value)}
                      placeholder="Nom du bot"
                      maxLength={32}
                      className="flex-1 px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
                      onKeyDown={e => { if (e.key === 'Enter' && newBotName.trim()) createBot.mutate(newBotName.trim()) }}
                    />
                    <button
                      onClick={() => { if (newBotName.trim()) createBot.mutate(newBotName.trim()) }}
                      disabled={!newBotName.trim() || createBot.isPending}
                      className="flex items-center gap-2 px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition disabled:opacity-50"
                    >
                      <Plus size={14} />
                      {createBot.isPending ? 'Création...' : 'Créer le bot'}
                    </button>
                  </div>

                  {/* Token créé — à copier maintenant */}
                  {createdToken && (
                    <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                      <div className="text-yellow-400 font-semibold text-sm mb-2">
                        ⚠️ Token de {createdToken.name} — Copiez-le maintenant !
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 bg-fc-input px-3 py-2 rounded text-sm text-white font-mono break-all">
                          {createdToken.token}
                        </code>
                        <button onClick={copyToken}
                          className={`p-2 rounded transition flex-shrink-0 ${copiedToken ? 'bg-fc-green text-white' : 'bg-fc-hover text-fc-muted hover:text-white'}`}
                        >
                          {copiedToken ? <Check size={16} /> : <Copy size={16} />}
                        </button>
                      </div>
                      <button onClick={() => setCreatedToken(null)} className="text-xs text-fc-muted mt-2 hover:text-white transition">
                        Fermer
                      </button>
                    </div>
                  )}

                  {/* Liste bots */}
                  {bots.length === 0 ? (
                    <div className="text-center text-fc-muted py-10 text-sm">
                      Aucun bot sur ce serveur.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {bots.map((bot: any) => (
                        <div key={bot.bot_user_id} className="flex items-center gap-3 p-3 bg-fc-channel rounded-lg">
                          <div className="w-10 h-10 rounded-full bg-indigo-500/30 flex items-center justify-center flex-shrink-0">
                            {bot.avatar
                              ? <img src={bot.avatar} alt="" className="w-full h-full object-cover rounded-full" />
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
                            title="Régénérer le token"
                          >
                            <RefreshCw size={14} />
                          </button>
                          <button onClick={() => deleteBot.mutate(bot.bot_user_id)}
                            className="p-1.5 text-fc-muted hover:text-red-400 hover:bg-fc-hover rounded transition"
                            title="Supprimer le bot"
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

            {tab === 'events'  && <ServerEventsPage serverId={server.id} />}
            {tab === 'stats'   && <StatsTab serverId={server.id} />}
            {tab === 'roles'   && <RolesTab serverId={server.id} />}
            {tab === 'members' && <MembersTab serverId={server.id} />}
            {tab === 'bans'    && <BansTab serverId={server.id} />}
            {tab === 'tags'    && <TagsTab serverId={server.id} />}
            {tab === 'webhooks' && <WebhooksTab server={server} channels={channels} />}
            {tab === 'feeds'   && <FeedsTab serverId={server.id} channels={channels} />}
            {tab === 'audit'   && <AuditLogTab server={server} />}
            {tab === 'automod' && <AutoModTab server={server} channels={channels} />}
          </div>
        </div>
      </div>
    </div>
  )
  return createPortal(modal, document.body)
}
