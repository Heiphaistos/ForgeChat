import { useState } from 'react'
import { Plus, Trash2, Copy, Check, Link } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client'
import toast from 'react-hot-toast'

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
  token: string
  avatar: string | null
  created_at: string
}

interface Props {
  server: Server
  channels: Channel[]
}

const WEBHOOK_BASE = 'https://forgechat.heiphaistos.org/api/webhook'

export default function WebhooksTab({ server, channels }: Props) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [channelId, setChannelId] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const textChannels = channels.filter(c => c.type === 'text')

  const { data: webhooks = [], isLoading } = useQuery<Webhook[]>({
    queryKey: ['webhooks', server.id],
    queryFn: () => api.get(`/servers/${server.id}/webhooks`).then(r => r.data),
    retry: false,
  })

  const createWebhook = useMutation({
    mutationFn: () => api.post(`/servers/${server.id}/webhooks`, { name: name.trim(), channel_id: channelId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['webhooks', server.id] })
      setName('')
      setChannelId('')
      toast.success('Webhook créé')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur création webhook'),
  })

  const deleteWebhook = useMutation({
    mutationFn: (webhookId: string) => api.delete(`/servers/${server.id}/webhooks/${webhookId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['webhooks', server.id] })
      toast.success('Webhook supprimé')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur suppression'),
  })

  const copyUrl = (webhook: Webhook) => {
    const url = `${WEBHOOK_BASE}/${webhook.id}/${webhook.token}`
    navigator.clipboard.writeText(url)
    setCopiedId(webhook.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const getChannelName = (id: string) => channels.find(c => c.id === id)?.name ?? 'Inconnu'

  const canCreate = name.trim().length >= 2 && channelId !== ''

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
          <Link size={18} className="text-fc-accent" />
          Webhooks
        </h3>
        <p className="text-sm text-fc-muted mb-5">
          Les webhooks permettent à des services externes d'envoyer des messages dans un canal.
        </p>

        {/* Formulaire création */}
        <div className="p-4 bg-fc-channel rounded-lg mb-6 space-y-3">
          <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">Nouveau webhook</div>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Nom du webhook"
            maxLength={80}
            className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
          />
          <select
            value={channelId}
            onChange={e => setChannelId(e.target.value)}
            className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
          >
            <option value="">Sélectionner un canal</option>
            {textChannels.map(c => (
              <option key={c.id} value={c.id}>#{c.name}</option>
            ))}
          </select>
          <button
            onClick={() => createWebhook.mutate()}
            disabled={!canCreate || createWebhook.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition disabled:opacity-50"
          >
            <Plus size={14} />
            {createWebhook.isPending ? 'Création...' : 'Créer le webhook'}
          </button>
        </div>

        {/* Liste */}
        {isLoading ? (
          <div className="text-center text-fc-muted py-10 text-sm">Chargement...</div>
        ) : webhooks.length === 0 ? (
          <div className="text-center text-fc-muted py-10 text-sm">Aucun webhook sur ce serveur.</div>
        ) : (
          <div className="space-y-3">
            {webhooks.map(wh => {
              const url = `${WEBHOOK_BASE}/${wh.id}/${wh.token}`
              const isCopied = copiedId === wh.id
              return (
                <div key={wh.id} className="p-4 bg-fc-channel rounded-lg">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-fc-accent/20 flex items-center justify-center flex-shrink-0">
                        {wh.avatar
                          ? <img src={wh.avatar} alt="" loading="lazy" decoding="async" className="w-full h-full rounded-full object-cover" />
                          : <Link size={16} className="text-fc-accent" />}
                      </div>
                      <div className="min-w-0">
                        <div className="text-white font-medium text-sm">{wh.name}</div>
                        <div className="text-xs text-fc-muted">#{getChannelName(wh.channel_id)}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => deleteWebhook.mutate(wh.id)}
                      className="p-1.5 text-fc-muted hover:text-red-400 hover:bg-fc-hover rounded transition flex-shrink-0"
                      title="Supprimer"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {/* URL */}
                  <div className="flex items-center gap-2">
                    <code className="flex-1 min-w-0 bg-fc-input px-3 py-1.5 rounded text-xs text-fc-muted font-mono truncate">
                      {url}
                    </code>
                    <button
                      onClick={() => copyUrl(wh)}
                      className={`p-1.5 rounded transition flex-shrink-0 ${isCopied ? 'bg-fc-green text-white' : 'bg-fc-hover text-fc-muted hover:text-white'}`}
                      title="Copier l'URL"
                    >
                      {isCopied ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                  {isCopied && (
                    <div className="text-xs text-fc-green mt-1">Copié !</div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
