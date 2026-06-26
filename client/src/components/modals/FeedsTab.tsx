import { useState } from 'react'
import { Plus, Trash2, Rss, Youtube, Github, MessageSquare, ToggleLeft, ToggleRight, Copy, Check } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api, { SERVER_URL } from '../../api/client'
import toast from 'react-hot-toast'

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
  const def = FEED_TYPES.find(t => t.value === type) ?? FEED_TYPES[0]
  const { Icon, color, bg, label } = def
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${bg} ${color}`}>
      <Icon size={10} />
      {label}
    </span>
  )
}

export default function FeedsTab({ serverId, channels }: Props) {
  const qc = useQueryClient()

  const [selectedChannelId, setSelectedChannelId] = useState('')
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newType, setNewType] = useState('rss')
  const [copied, setCopied] = useState(false)

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
      toast.success('Flux RSS ajouté')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur création flux'),
  })

  const deleteFeed = useMutation({
    mutationFn: (feedId: string) => api.delete(`/servers/${serverId}/feeds/${feedId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feeds', serverId, selectedChannelId] })
      toast.success('Flux supprimé')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur suppression'),
  })

  const toggleFeed = useMutation({
    mutationFn: (feedId: string) => api.patch(`/servers/${serverId}/feeds/${feedId}/toggle`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feeds', serverId, selectedChannelId] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur toggle'),
  })

  const webhookBase = SERVER_URL || (typeof window !== 'undefined' ? window.location.origin : '')
  const webhookUrl = selectedChannelId
    ? `${webhookBase}/api/github-webhook/${selectedChannelId}`
    : ''

  function copyWebhookUrl() {
    if (!webhookUrl) return
    navigator.clipboard.writeText(webhookUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast.success('URL copiée')
  }

  const canCreate =
    selectedChannelId !== '' &&
    newName.trim().length >= 1 &&
    newUrl.trim().startsWith('http')

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
          <Rss size={18} className="text-orange-400" />
          Flux RSS / YouTube / GitHub
        </h3>
        <p className="text-sm text-fc-muted mb-3">
          Abonnez un canal à des flux RSS, YouTube ou GitHub. Les nouveaux contenus sont postés automatiquement toutes les 5 minutes.
        </p>

        {/* Lien RSSDI */}
        <div className="mb-5 p-3 bg-indigo-900/20 border border-indigo-500/30 rounded-xl flex items-center gap-3">
          <Rss size={18} className="text-indigo-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white">Importer depuis RSSDI</p>
            <p className="text-xs text-fc-muted">Accédez à votre agrégateur de flux RSS personnel pour trouver et copier des URLs de flux.</p>
          </div>
          <a
            href="https://rssdi.heiphaistos.org"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg transition flex-shrink-0"
          >
            Ouvrir RSSDI
          </a>
        </div>

        {/* Sélection du canal */}
        <div className="mb-5">
          <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">
            Canal à surveiller
          </label>
          <select
            value={selectedChannelId}
            onChange={e => setSelectedChannelId(e.target.value)}
            className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
          >
            <option value="">Sélectionner un canal</option>
            {textChannels.map(c => (
              <option key={c.id} value={c.id}>#{c.name}</option>
            ))}
          </select>
        </div>

        {/* Formulaire d'ajout */}
        {selectedChannelId && (
          <div className="p-4 bg-fc-channel rounded-lg mb-6 space-y-3">
            <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">
              Ajouter un flux
            </div>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Nom du flux (ex: Hacker News)"
              maxLength={100}
              className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
            />
            <input
              value={newUrl}
              onChange={e => setNewUrl(e.target.value)}
              placeholder="URL du flux (https://...)"
              maxLength={2048}
              className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm font-mono text-xs"
            />
            <select
              value={newType}
              onChange={e => setNewType(e.target.value)}
              className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
            >
              {FEED_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <button
              onClick={() => createFeed.mutate()}
              disabled={!canCreate || createFeed.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition disabled:opacity-50"
            >
              <Plus size={14} />
              {createFeed.isPending ? 'Ajout...' : 'Ajouter le flux'}
            </button>
          </div>
        )}

        {/* Liste des feeds */}
        {selectedChannelId && (
          isLoading ? (
            <div className="text-center text-fc-muted py-10 text-sm">Chargement...</div>
          ) : feeds.length === 0 ? (
            <div className="text-center text-fc-muted py-10 text-sm">
              Aucun flux abonné sur ce canal.
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
                        Vérifié : {new Date(feed.last_checked_at).toLocaleString('fr-FR')}
                      </div>
                    )}
                  </div>

                  {/* Toggle enabled */}
                  <button
                    onClick={() => toggleFeed.mutate(feed.id)}
                    disabled={toggleFeed.isPending}
                    className="p-1.5 text-fc-muted hover:text-white hover:bg-fc-hover rounded transition flex-shrink-0"
                    title={feed.enabled ? 'Désactiver' : 'Activer'}
                  >
                    {feed.enabled
                      ? <ToggleRight size={18} className="text-fc-green" />
                      : <ToggleLeft size={18} />
                    }
                  </button>

                  {/* Supprimer */}
                  <button
                    onClick={() => deleteFeed.mutate(feed.id)}
                    disabled={deleteFeed.isPending}
                    className="p-1.5 text-fc-muted hover:text-red-400 hover:bg-fc-hover rounded transition flex-shrink-0"
                    title="Supprimer ce flux"
                  >
                    <Trash2 size={14} />
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
          <Github size={18} className="text-gray-300" />
          Webhooks GitHub entrants
        </h3>
        <p className="text-sm text-fc-muted mb-5">
          Configurez un webhook GitHub pour recevoir les événements push, pull request et issues directement dans un canal.
          Sélectionnez un canal ci-dessus puis copiez l'URL à renseigner dans les paramètres GitHub de votre dépôt
          (Settings → Webhooks → Add webhook, Content type: <code className="text-xs bg-fc-hover px-1 rounded">application/json</code>).
        </p>

        {selectedChannelId ? (
          <div className="p-4 bg-fc-channel rounded-lg space-y-3">
            <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide">URL du webhook</div>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={webhookUrl}
                className="flex-1 px-3 py-2 bg-fc-input rounded text-white text-xs font-mono outline-none select-all"
                onFocus={e => e.target.select()}
              />
              <button
                onClick={copyWebhookUrl}
                className="flex items-center gap-1.5 px-3 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition flex-shrink-0"
                title="Copier l'URL"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copié !' : 'Copier'}
              </button>
            </div>
            <div className="text-xs text-fc-muted space-y-1">
              <div>Événements supportés : <span className="text-white">push</span>, <span className="text-white">pull_request</span>, <span className="text-white">issues</span></div>
            </div>
          </div>
        ) : (
          <div className="text-center text-fc-muted py-6 text-sm bg-fc-channel/40 rounded-lg">
            Sélectionnez un canal pour obtenir l'URL du webhook GitHub.
          </div>
        )}
      </div>
    </div>
  )
}
