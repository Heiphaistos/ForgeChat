import { useState, useEffect } from 'react'
import { Plus, Trash2, Rss, Youtube, Github, MessageSquare, ToggleLeft, ToggleRight, Copy, Check, KeyRound } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api, { SERVER_URL } from '../../api/client'
import toast from 'react-hot-toast'
import { useT, intlLocale } from '../../i18n'

interface Channel {
  id: string
  name: string
  type: string
}

interface Feed {
  id: string
  channel_id: string
  server_id: string
  name: string
  feed_url: string
  feed_type: string
  enabled: boolean
  last_checked_at: string | null
  created_at: string
}

interface Props {
  serverId: string
  channels: Channel[]
}

const FEED_TYPES = [
  { value: 'rss', label: 'RSS', Icon: Rss, color: 'text-orange-400', bg: 'bg-orange-400/20' },
  { value: 'youtube', label: 'YouTube', Icon: Youtube, color: 'text-red-400', bg: 'bg-red-400/20' },
  { value: 'reddit', label: 'Reddit', Icon: MessageSquare, color: 'text-orange-500', bg: 'bg-orange-500/20' },
  { value: 'github', label: 'GitHub', Icon: Github, color: 'text-gray-300', bg: 'bg-gray-500/20' },
]

function FeedTypeBadge({ type }: { type: string }) {
  const def = FEED_TYPES.find(ft => ft.value === type) ?? FEED_TYPES[0]
  const { Icon, color, bg, label } = def
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${bg} ${color}`}>
      <Icon size={10} aria-hidden />
      {label}
    </span>
  )
}

export default function FeedsTab({ serverId, channels }: Props) {
  const t = useT()
  const qc = useQueryClient()

  const [selectedChannelId, setSelectedChannelId] = useState('')
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newType, setNewType] = useState('rss')
  const [copied, setCopied] = useState(false)
  // Le backend n'expose jamais le token en lecture (comme les webhooks Discord) --
  // on génère un nouveau secret côté client, on le sauvegarde, puis on affiche
  // l'URL complète une seule fois. Réinitialisé à chaque changement de canal.
  const [githubToken, setGithubToken] = useState('')
  const [tokenSaved, setTokenSaved] = useState(false)

  useEffect(() => { setGithubToken(''); setTokenSaved(false) }, [selectedChannelId])

  function generateSecret() {
    const bytes = crypto.getRandomValues(new Uint8Array(24))
    setGithubToken(Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''))
    setTokenSaved(false)
  }

  const saveGithubToken = useMutation({
    mutationFn: () => api.put(`/servers/${serverId}/channels/${selectedChannelId}/github-webhook-token`, { token: githubToken }),
    onSuccess: () => { setTokenSaved(true); toast.success(t('feeds.tokenSaved')) },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('feeds.tokenError')),
  })

  const textChannels = channels.filter(c => c.type === 'text')

  // Feeds du canal sélectionné
  const { data: feeds = [], isLoading } = useQuery<Feed[]>({
    queryKey: ['feeds', serverId, selectedChannelId],
    queryFn: () =>
      api.get(`/servers/${serverId}/channels/${selectedChannelId}/feeds`).then(r => r.data),
    enabled: !!selectedChannelId,
  })

  const createFeed = useMutation({
    mutationFn: () =>
      api.post(`/servers/${serverId}/channels/${selectedChannelId}/feeds`, {
        name: newName.trim(),
        feed_url: newUrl.trim(),
        feed_type: newType,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feeds', serverId, selectedChannelId] })
      setNewName('')
      setNewUrl('')
      setNewType('rss')
      toast.success(t('feeds.added'))
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('feeds.addError')),
  })

  const deleteFeed = useMutation({
    mutationFn: (feedId: string) => api.delete(`/servers/${serverId}/feeds/${feedId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feeds', serverId, selectedChannelId] })
      toast.success(t('feeds.deleted'))
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('settings.adv.deleteError')),
  })

  const toggleFeed = useMutation({
    mutationFn: (feedId: string) => api.patch(`/servers/${serverId}/feeds/${feedId}/toggle`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feeds', serverId, selectedChannelId] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('common.error')),
  })

  const webhookBase = SERVER_URL || (typeof window !== 'undefined' ? window.location.origin : '')
  // Le token est obligatoire côté serveur (verify_github_token_get) -- sans lui
  // l'URL est invalide et toute livraison GitHub échoue en 401.
  const webhookUrl = selectedChannelId && tokenSaved
    ? `${webhookBase}/api/github-webhook/${selectedChannelId}?token=${githubToken}`
    : ''

  function copyWebhookUrl() {
    if (!webhookUrl) return
    navigator.clipboard.writeText(webhookUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast.success(t('webhooks.copied'))
  }

  const canCreate =
    selectedChannelId !== '' &&
    newName.trim().length >= 1 &&
    newUrl.trim().startsWith('http')

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
          <Rss size={18} className="text-orange-400" aria-hidden />
          {t('feeds.title')}
        </h3>
        <p className="text-sm text-fc-muted mb-3">
          {t('feeds.intro')}
        </p>

        {/* Lien RSSDI */}
        <div className="mb-5 p-3 bg-indigo-900/20 border border-indigo-500/30 rounded-xl flex items-center gap-3">
          <Rss size={18} className="text-indigo-400 flex-shrink-0" aria-hidden />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white">{t('feeds.rssdi')}</p>
            <p className="text-xs text-fc-muted">{t('feeds.rssdiDesc')}</p>
          </div>
          <a
            href="https://rssdi.heiphaistos.org"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg transition flex-shrink-0"
          >
            {t('feeds.openRssdi')}
          </a>
        </div>

        {/* Sélection du canal */}
        <div className="mb-5">
          <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2" htmlFor="feeds-channel-select">
            {t('feeds.channel')}
          </label>
          <select
            id="feeds-channel-select"
            value={selectedChannelId}
            onChange={e => setSelectedChannelId(e.target.value)}
            className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
          >
            <option value="">{t('webhooks.pickChannel')}</option>
            {textChannels.map(c => (
              <option key={c.id} value={c.id}>#{c.name}</option>
            ))}
          </select>
        </div>

        {/* Formulaire d'ajout */}
        {selectedChannelId && (
          <div className="p-4 bg-fc-channel rounded-lg mb-6 space-y-3">
            <div aria-hidden className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">
              {t('feeds.add')}
            </div>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder={t('feeds.namePh')}
              maxLength={100}
              aria-label={t('feeds.name')}
              enterKeyHint="next"
              autoCapitalize="sentences"
              className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
            />
            <input
              value={newUrl}
              onChange={e => setNewUrl(e.target.value)}
              placeholder={t('feeds.urlPh')}
              maxLength={2048}
              aria-label={t('feeds.url')}
              enterKeyHint="done"
              inputMode="url"
              autoCapitalize="none"
              autoComplete="off"
              className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm font-mono text-xs"
            />
            <select
              value={newType}
              onChange={e => setNewType(e.target.value)}
              aria-label={t('feeds.type')}
              className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
            >
              {FEED_TYPES.map(ft => (
                <option key={ft.value} value={ft.value}>{ft.label}</option>
              ))}
            </select>
            <button
              onClick={() => createFeed.mutate()}
              disabled={!canCreate || createFeed.isPending}
              aria-busy={createFeed.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition disabled:opacity-50"
            >
              <Plus size={14} aria-hidden />
              {createFeed.isPending ? t('feeds.adding') : t('feeds.addButton')}
            </button>
          </div>
        )}

        {/* Liste des feeds */}
        {selectedChannelId && (
          isLoading ? (
            <div role="status" aria-label={t('feeds.loading')} className="text-center text-fc-muted py-10 text-sm">{t('common.loading')}</div>
          ) : feeds.length === 0 ? (
            <div role="status" className="text-center text-fc-muted py-10 text-sm">
              {t('feeds.none')}
            </div>
          ) : (
            <div className="space-y-2">
              {feeds.map(feed => (
                <div
                  key={feed.id}
                  className={`flex items-center gap-3 p-3 rounded-lg transition ${
                    feed.enabled ? 'bg-fc-channel' : 'bg-fc-channel/40 opacity-60'
                  }`}
                >
                  {/* Icône type */}
                  <div className="flex-shrink-0">
                    <FeedTypeBadge type={feed.feed_type} />
                  </div>

                  {/* Infos */}
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-medium truncate">{feed.name}</div>
                    <div className="text-xs text-fc-muted font-mono truncate">{feed.feed_url}</div>
                    {feed.last_checked_at && (
                      <div className="text-xs text-fc-muted mt-0.5">
                        {t('feeds.checked', { date: new Date(feed.last_checked_at).toLocaleString(intlLocale()) })}
                      </div>
                    )}
                  </div>

                  {/* Toggle enabled */}
                  <button
                    onClick={() => toggleFeed.mutate(feed.id)}
                    disabled={toggleFeed.isPending}
                    aria-label={feed.enabled ? t('feeds.disable', { name: feed.name }) : t('feeds.enable', { name: feed.name })}
                    aria-pressed={feed.enabled}
                    className="p-1.5 text-fc-muted hover:text-white hover:bg-fc-hover rounded transition flex-shrink-0"
                  >
                    {feed.enabled
                      ? <ToggleRight size={18} className="text-fc-green" aria-hidden />
                      : <ToggleLeft size={18} aria-hidden />
                    }
                  </button>

                  {/* Supprimer */}
                  <button
                    onClick={() => deleteFeed.mutate(feed.id)}
                    disabled={deleteFeed.isPending}
                    aria-label={t('feeds.delete', { name: feed.name })}
                    className="p-1.5 text-fc-muted hover:text-red-400 hover:bg-fc-hover rounded transition flex-shrink-0"
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          )
        )}
      </div>
      {/* GitHub Webhooks entrants */}
      <div>
        <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
          <Github size={18} className="text-gray-300" aria-hidden />
          {t('feeds.ghTitle')}
        </h3>
        <p className="text-sm text-fc-muted mb-5">
          {t('feeds.ghIntro')} <code className="text-xs bg-fc-hover px-1 rounded">application/json</code>{t('feeds.ghIntroEnd')}
        </p>

        {selectedChannelId ? (
          <div className="p-4 bg-fc-channel rounded-lg space-y-3">
            {!tokenSaved ? (
              <>
                <div aria-hidden className="text-xs font-semibold text-fc-muted uppercase tracking-wide">
                  {t('feeds.ghStep1')}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={githubToken}
                    onChange={e => setGithubToken(e.target.value)}
                    placeholder={t('feeds.ghSecretPh')}
                    aria-label={t('feeds.ghSecret')}
                    className="flex-1 px-3 py-2 bg-fc-input rounded text-white text-xs font-mono outline-none focus:ring-2 focus:ring-fc-accent"
                  />
                  <button
                    onClick={generateSecret}
                    className="flex items-center gap-1.5 px-3 py-2 bg-fc-hover hover:bg-fc-accent/30 text-white rounded text-sm font-medium transition flex-shrink-0"
                  >
                    <KeyRound size={14} aria-hidden />
                    {t('feeds.generate')}
                  </button>
                </div>
                <button
                  onClick={() => saveGithubToken.mutate()}
                  disabled={githubToken.trim().length < 16 || saveGithubToken.isPending}
                  aria-busy={saveGithubToken.isPending}
                  className="px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition disabled:opacity-50"
                >
                  {saveGithubToken.isPending ? t('common.recording') : t('feeds.saveAndUrl')}
                </button>
              </>
            ) : (
              <>
                <div aria-hidden className="text-xs font-semibold text-fc-muted uppercase tracking-wide">
                  {t('feeds.ghUrlWarning')}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={webhookUrl}
                    aria-label={t('feeds.ghUrl')}
                    className="flex-1 px-3 py-2 bg-fc-input rounded text-white text-xs font-mono outline-none select-all"
                    onFocus={e => e.target.select()}
                  />
                  <button
                    onClick={copyWebhookUrl}
                    aria-label={copied ? t('webhooks.copied') : t('feeds.ghCopy')}
                    className="flex items-center gap-1.5 px-3 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition flex-shrink-0"
                  >
                    {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                    <span aria-hidden>{copied ? t('feeds.copied') : t('feeds.copy')}</span>
                  </button>
                </div>
                <button onClick={() => setTokenSaved(false)} className="text-xs text-fc-muted hover:text-white transition">
                  {t('feeds.newSecret')}
                </button>
              </>
            )}
            <div className="text-xs text-fc-muted space-y-1">
              <div>{t('feeds.events')} <span className="text-white">push</span>, <span className="text-white">pull_request</span>, <span className="text-white">issues</span></div>
            </div>
          </div>
        ) : (
          <div role="status" className="text-center text-fc-muted py-6 text-sm bg-fc-channel/40 rounded-lg">
            {t('feeds.pickForGh')}
          </div>
        )}
      </div>
    </div>
  )
}
