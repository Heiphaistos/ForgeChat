import { useState } from 'react'
import { Plus, Trash2, Copy, Check, Link } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api, { mediaUrl } from '../../api/client'
import toast from 'react-hot-toast'
import { useT } from '../../i18n'

interface Channel {
  id: string
  name: string
  type: string
}

interface Server {
  id: string
  name: string
}

interface Webhook {
  id: string
  name: string
  channel_id: string
  // Token complet — présent uniquement dans la réponse de création, jamais dans la liste
  token: string | null
  token_preview: string
  avatar: string | null
  created_at: string
}

interface Props {
  server: Server
  channels: Channel[]
}

const WEBHOOK_BASE = 'https://forgechat.heiphaistos.org/api/webhook'

export default function WebhooksTab({ server, channels }: Props) {
  const t = useT()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [channelId, setChannelId] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  // URL complète révélée une seule fois, juste après la création (le serveur ne
  // renvoie plus jamais le token en clair ensuite — même pattern que les bots)
  const [createdUrl, setCreatedUrl] = useState<{ name: string; url: string } | null>(null)

  const textChannels = channels.filter(c => c.type === 'text')

  const { data: webhooks = [], isLoading } = useQuery<Webhook[]>({
    queryKey: ['webhooks', server.id],
    queryFn: () => api.get(`/servers/${server.id}/webhooks`).then(r => r.data),
    retry: false,
  })

  const createWebhook = useMutation({
    mutationFn: () => api.post<Webhook>(`/servers/${server.id}/webhooks`, { name: name.trim(), channel_id: channelId }),
    onSuccess: ({ data }) => {
      qc.invalidateQueries({ queryKey: ['webhooks', server.id] })
      setCreatedUrl({ name: data.name, url: `${WEBHOOK_BASE}/${data.id}/${data.token}` })
      setName('')
      setChannelId('')
      toast.success(t('webhooks.created'))
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('webhooks.createError')),
  })

  const deleteWebhook = useMutation({
    mutationFn: (webhookId: string) => api.delete(`/servers/${server.id}/webhooks/${webhookId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['webhooks', server.id] })
      toast.success(t('webhooks.deleted'))
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('settings.adv.deleteError')),
  })

  const copyCreatedUrl = () => {
    if (!createdUrl) return
    navigator.clipboard.writeText(createdUrl.url)
    setCopiedId('__created__')
    setTimeout(() => setCopiedId(null), 2000)
  }

  const getChannelName = (id: string) => channels.find(c => c.id === id)?.name ?? t('webhooks.unknown')

  const canCreate = name.trim().length >= 2 && channelId !== ''

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
          <Link size={18} className="text-fc-accent" aria-hidden />
          Webhooks
        </h3>
        <p className="text-sm text-fc-muted mb-5">
          {t('webhooks.intro')}
        </p>

        {/* Formulaire création */}
        <div className="p-4 bg-fc-channel rounded-lg mb-6 space-y-3">
          <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2" aria-hidden>{t('webhooks.new')}</div>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={t('webhooks.name')}
            maxLength={80}
            aria-label={t('webhooks.name')}
            enterKeyHint="done"
            autoCapitalize="sentences"
            className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
          />
          <select
            value={channelId}
            onChange={e => setChannelId(e.target.value)}
            aria-label={t('webhooks.channel')}
            className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
          >
            <option value="">{t('webhooks.pickChannel')}</option>
            {textChannels.map(c => (
              <option key={c.id} value={c.id}>#{c.name}</option>
            ))}
          </select>
          <button
            onClick={() => createWebhook.mutate()}
            disabled={!canCreate || createWebhook.isPending}
            aria-busy={createWebhook.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition disabled:opacity-50"
          >
            <Plus size={14} aria-hidden />
            {createWebhook.isPending ? t('common.creating') : t('webhooks.create')}
          </button>
        </div>

        {/* URL révélée à la création — plus jamais affichée en clair ensuite */}
        {createdUrl && (
          <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <div className="text-yellow-400 font-semibold text-sm mb-2">
              {t('webhooks.urlWarning', { name: createdUrl.name })}
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 bg-fc-input px-3 py-2 rounded text-xs text-white font-mono break-all">
                {createdUrl.url}
              </code>
              <button
                onClick={copyCreatedUrl}
                aria-label={copiedId === '__created__' ? t('webhooks.copied') : t('webhooks.copy')}
                className={`p-2 rounded transition flex-shrink-0 ${copiedId === '__created__' ? 'bg-fc-green text-white' : 'bg-fc-hover text-fc-muted hover:text-white'}`}
              >
                {copiedId === '__created__' ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
              </button>
            </div>
            <button onClick={() => setCreatedUrl(null)} className="text-xs text-fc-muted mt-2 hover:text-white transition">
              {t('common.close')}
            </button>
          </div>
        )}

        {/* Liste */}
        {isLoading ? (
          <div role="status" aria-label={t('webhooks.loading')} className="text-center text-fc-muted py-10 text-sm">{t('common.loading')}</div>
        ) : webhooks.length === 0 ? (
          <div role="status" className="text-center text-fc-muted py-10 text-sm">{t('webhooks.none')}</div>
        ) : (
          <div className="space-y-3">
            {webhooks.map(wh => (
              <div key={wh.id} className="p-4 bg-fc-channel rounded-lg">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-fc-accent/20 flex items-center justify-center flex-shrink-0" aria-hidden>
                      {wh.avatar
                        ? <img src={mediaUrl(wh.avatar)} alt="" loading="lazy" decoding="async" className="w-full h-full rounded-full object-cover" />
                        : <Link size={16} className="text-fc-accent" />}
                    </div>
                    <div className="min-w-0">
                      <div className="text-white font-medium text-sm">{wh.name}</div>
                      <div className="text-xs text-fc-muted">#{getChannelName(wh.channel_id)}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => deleteWebhook.mutate(wh.id)}
                    aria-label={t('webhooks.delete', { name: wh.name })}
                    className="p-1.5 text-fc-muted hover:text-red-400 hover:bg-fc-hover rounded transition flex-shrink-0"
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </div>

                {/* Token masqué — l'URL complète n'est révélée qu'à la création */}
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 bg-fc-input px-3 py-1.5 rounded text-xs text-fc-muted font-mono truncate">
                    {WEBHOOK_BASE}/{wh.id}/{wh.token_preview}
                  </code>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
