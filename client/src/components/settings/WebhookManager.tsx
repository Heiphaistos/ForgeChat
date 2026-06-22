import { useState } from 'react'
import { Plus, Trash2, Copy, Check, Link, Webhook } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client'
import toast from 'react-hot-toast'

interface WebhookManagerProps {
  serverId: string
}

interface Channel {
  id: string
  name: string
  type: string
}

interface WebhookItem {
  id: string
  name: string
  channel_id: string
  token_preview: string
  avatar: string | null
  created_at: string
}

interface CreatedWebhook extends WebhookItem {
  token_preview: string
}

const BASE_URL = 'https://forgechat.heiphaistos.org/api/webhook'

export default function WebhookManager({ serverId }: WebhookManagerProps) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [channelId, setChannelId] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [createdWebhook, setCreatedWebhook] = useState<CreatedWebhook | null>(null)

  const { data: channels = [] } = useQuery<Channel[]>({
    queryKey: ['server_channels', serverId],
    queryFn: () => api.get(`/servers/${serverId}/channels`).then(r => r.data),
  })

  const textChannels = channels.filter(c => c.type === 'text' || c.type === 'announcement')

  const { data: webhooks = [], isLoading } = useQuery<WebhookItem[]>({
    queryKey: ['webhooks', serverId],
    queryFn: () => api.get(`/servers/${serverId}/webhooks`).then(r => r.data),
  })

  const createWebhook = useMutation({
    mutationFn: () =>
      api.post(`/servers/${serverId}/webhooks`, {
        name: name.trim(),
        channel_id: channelId,
      }).then(r => r.data),
    onSuccess: (data: CreatedWebhook) => {
      qc.invalidateQueries({ queryKey: ['webhooks', serverId] })
      setCreatedWebhook(data)
      setName('')
      setChannelId('')
      toast.success('Webhook créé — copiez le token maintenant')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur création'),
  })

  const deleteWebhook = useMutation({
    mutationFn: (webhookId: string) =>
      api.delete(`/servers/${serverId}/webhooks/${webhookId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['webhooks', serverId] })
      toast.success('Webhook supprimé')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur suppression'),
  })

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const getChannelName = (id: string) =>
    channels.find(c => c.id === id)?.name ?? 'Inconnu'

  const canCreate = name.trim().length >= 2 && channelId !== ''

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
          <Link size={18} className="text-fc-accent" />
          Intégrations — Webhooks
        </h3>
        <p className="text-sm text-fc-muted mb-5">
          Les webhooks permettent à des services externes d'envoyer des messages dans un canal.
        </p>

        {/* Formulaire création */}
        <div className="p-4 bg-fc-channel rounded-lg mb-6 space-y-3">
          <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">
            Nouveau webhook
          </div>
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
            <option value="">Sélectionner un canal cible</option>
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

        {/* Token créé — affiché une seule fois */}
        {createdWebhook && (
          <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <div className="text-yellow-400 font-semibold text-sm mb-2">
              Webhook créé — copiez l'URL maintenant (token affiché une seule fois)
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-fc-input px-3 py-2 rounded text-xs text-white font-mono break-all">
                {`${BASE_URL}/${createdWebhook.id}/${createdWebhook.token_preview.replace('...', '')}`}
              </code>
              <button
                onClick={() =>
                  copyToClipboard(
                    `${BASE_URL}/${createdWebhook.id}/${createdWebhook.token_preview.replace('...', '')}`,
                    'created'
                  )
                }
                className={`p-2 rounded transition flex-shrink-0 ${copiedId === 'created' ? 'bg-fc-green text-white' : 'bg-fc-hover text-fc-muted hover:text-white'}`}
              >
                {copiedId === 'created' ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            <button
              onClick={() => setCreatedWebhook(null)}
              className="text-xs text-fc-muted mt-2 hover:text-white transition"
            >
              Fermer
            </button>
          </div>
        )}

        {/* Liste */}
        {isLoading ? (
          <div className="text-center text-fc-muted py-10 text-sm">Chargement...</div>
        ) : webhooks.length === 0 ? (
          <div className="text-center text-fc-muted py-10 text-sm">
            Aucun webhook configuré.
          </div>
        ) : (
          <div className="space-y-3">
            {webhooks.map(wh => {
              const isCopied = copiedId === wh.id
              return (
                <div key={wh.id} className="p-4 bg-fc-channel rounded-lg">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-fc-accent/20 flex items-center justify-center flex-shrink-0">
                        {wh.avatar
                          ? <img src={wh.avatar} alt="" className="w-full h-full rounded-full object-cover" />
                          : <Webhook size={16} className="text-fc-accent" />}
                      </div>
                      <div className="min-w-0">
                        <div className="text-white font-medium text-sm">{wh.name}</div>
                        <div className="text-xs text-fc-muted">#{getChannelName(wh.channel_id)}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => deleteWebhook.mutate(wh.id)}
                      disabled={deleteWebhook.isPending}
                      className="p-1.5 text-fc-muted hover:text-red-400 hover:bg-fc-hover rounded transition flex-shrink-0 disabled:opacity-40"
                      title="Supprimer ce webhook"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {/* URL (token masqué) */}
                  <div className="flex items-center gap-2">
                    <code className="flex-1 min-w-0 bg-fc-input px-3 py-1.5 rounded text-xs text-fc-muted font-mono truncate">
                      {`${BASE_URL}/${wh.id}/[token masqué]`}
                    </code>
                    <button
                      onClick={() =>
                        copyToClipboard(`${BASE_URL}/${wh.id}/`, wh.id)
                      }
                      className={`p-1.5 rounded transition flex-shrink-0 ${isCopied ? 'bg-fc-green text-white' : 'bg-fc-hover text-fc-muted hover:text-white'}`}
                      title="Copier l'URL de base"
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
