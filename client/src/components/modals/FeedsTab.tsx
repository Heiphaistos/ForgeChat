import { useState, useEffect } from 'react'
import { Plus, Trash2, Rss, Youtube, Github, MessageSquare, ToggleLeft, ToggleRight, Copy, Check, KeyRound } from 'lucide-react'
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
      <Icon size={10} aria-hidden />
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
    onSuccess: () => { setTokenSaved(true); toast.success('Token enregistré') },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur enregistrement token'),
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
          <Rss size={18} className="text-orange-400" aria-hidden />
          Flux RSS / YouTube / GitHub
        </h3>
        <p className="text-sm text-fc-muted mb-3">
          Abonnez un canal à des flux RSS, YouTube ou GitHub. Les nouveaux contenus sont postés automatiquement toutes les 5 minutes.
        </p>

        {/* Lien RSSDI */}
        <div className="mb-5 p-3 bg-indigo-900/20 border border-indigo-500/30 rounded-xl flex items-center gap-3">
          <Rss size={18} className="text-indigo-400 flex-shrink-0" aria-hidden />
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
          <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2" htmlFor="feeds-channel-select">
            Canal à surveiller
          </label>
          <select
            id="feeds-channel-select"
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
            <div aria-hidden className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">
              Ajouter un flux
            </div>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Nom du flux (ex: Hacker News)"
              maxLength={100}
              aria-label="Nom du flux"
              enterKeyHint="next"
              autoCapitalize="sentences"
              className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
            />
            <input
              value={newUrl}
              onChange={e => setNewUrl(e.target.value)}
              placeholder="URL du flux (https://...)"
              maxLength={2048}
              aria-label="URL du flux"
              enterKeyHint="done"
              inputMode="url"
              autoCapitalize="none"
              autoComplete="off"
              className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm font-mono text-xs"
            />
            <select
              value={newType}
              onChange={e => setNewType(e.target.value)}
              aria-label="Type de flux"
              className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
            >
              {FEED_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <button
              onClick={() => createFeed.mutate()}
              disabled={!canCreate || createFeed.isPending}
              aria-busy={createFeed.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition disabled:opacity-50"
            >
              <Plus size={14} aria-hidden />
              {createFeed.isPending ? 'Ajout...' : 'Ajouter le flux'}
            </button>
          </div>
        )}

        {/* Liste des feeds */}
        {selectedChannelId && (
          isLoading ? (
            <div role="status" aria-label="Chargement des flux" className="text-center text-fc-muted py-10 text-sm">Chargement...</div>
          ) : feeds.length === 0 ? (
            <div role="status" className="text-center text-fc-muted py-10 text-sm">
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
                    aria-label={feed.enabled ? `Désactiver le flux ${feed.name}` : `Activer le flux ${feed.name}`}
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
                    aria-label={`Supprimer le flux ${feed.name}`}
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
          Webhooks GitHub entrants
        </h3>
        <p className="text-sm text-fc-muted mb-5">
          Configurez un webhook GitHub pour recevoir les événements push, pull request et issues directement dans un canal.
          Sélectionnez un canal ci-dessus puis copiez l'URL à renseigner dans les paramètres GitHub de votre dépôt
          (Settings → Webhooks → Add webhook, Content type: <code className="text-xs bg-fc-hover px-1 rounded">application/json</code>).
        </p>

        {selectedChannelId ? (
          <div className="p-4 bg-fc-channel rounded-lg space-y-3">
            {!tokenSaved ? (
              <>
                <div aria-hidden className="text-xs font-semibold text-fc-muted uppercase tracking-wide">
                  1. Générer un secret pour ce canal
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={githubToken}
                    onChange={e => setGithubToken(e.target.value)}
                    placeholder="Cliquez sur Générer, ou saisissez un secret (min. 16 caractères)"
                    aria-label="Secret du webhook GitHub"
                    className="flex-1 px-3 py-2 bg-fc-input rounded text-white text-xs font-mono outline-none focus:ring-2 focus:ring-fc-accent"
                  />
                  <button
                    onClick={generateSecret}
                    className="flex items-center gap-1.5 px-3 py-2 bg-fc-hover hover:bg-fc-accent/30 text-white rounded text-sm font-medium transition flex-shrink-0"
                  >
                    <KeyRound size={14} aria-hidden />
                    Générer
                  </button>
                </div>
                <button
                  onClick={() => saveGithubToken.mutate()}
                  disabled={githubToken.trim().length < 16 || saveGithubToken.isPending}
                  aria-busy={saveGithubToken.isPending}
                  className="px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition disabled:opacity-50"
                >
                  {saveGithubToken.isPending ? 'Enregistrement...' : 'Enregistrer et générer l\'URL'}
                </button>
              </>
            ) : (
              <>
                <div aria-hidden className="text-xs font-semibold text-fc-muted uppercase tracking-wide">
                  URL du webhook — copiez-la maintenant, le secret ne sera plus jamais affiché
                </div>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={webhookUrl}
                    aria-label="URL du webhook GitHub"
                    className="flex-1 px-3 py-2 bg-fc-input rounded text-white text-xs font-mono outline-none select-all"
                    onFocus={e => e.target.select()}
                  />
                  <button
                    onClick={copyWebhookUrl}
                    aria-label={copied ? 'URL copiée' : "Copier l'URL du webhook GitHub"}
                    className="flex items-center gap-1.5 px-3 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition flex-shrink-0"
                  >
                    {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                    <span aria-hidden>{copied ? 'Copié !' : 'Copier'}</span>
                  </button>
                </div>
                <button onClick={() => setTokenSaved(false)} className="text-xs text-fc-muted hover:text-white transition">
                  Générer un nouveau secret
                </button>
              </>
            )}
            <div className="text-xs text-fc-muted space-y-1">
              <div>Événements supportés : <span className="text-white">push</span>, <span className="text-white">pull_request</span>, <span className="text-white">issues</span></div>
            </div>
          </div>
        ) : (
          <div role="status" className="text-center text-fc-muted py-6 text-sm bg-fc-channel/40 rounded-lg">
            Sélectionnez un canal pour obtenir l'URL du webhook GitHub.
          </div>
        )}
      </div>
    </div>
  )
}
