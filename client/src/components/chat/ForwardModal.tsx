import { useState, useMemo } from 'react'
import { X, Search, Send, ChevronDown, ChevronRight, Hash } from 'lucide-react'
import { useQuery, useMutation } from '@tanstack/react-query'
import api, { mediaUrl } from '../../api/client'
import toast from 'react-hot-toast'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useT } from '../../i18n'
import { mustEncrypt, seal, sendErrorText } from '../../e2e/conversations'

interface Props {
  messageId: string
  sourceChannelId: string
  sourceServerId: string
  /** Message chiffré : texte déchiffré à copier (le salon cible n'est pas chiffré). */
  plaintext?: string | null
  /** Texte lisible du message (clair ou déchiffré) : rechiffré si le salon cible est chiffré. */
  sourceText?: string | null
  onClose: () => void
}

interface Server {
  id: string
  name: string
  icon?: string | null
}

interface Channel {
  id: string
  name: string
  type: string
  server_id: string
}

export default function ForwardModal({ messageId, sourceChannelId, sourceServerId, plaintext, sourceText, onClose }: Props) {
  const t = useT()
  useEscapeKey(onClose)
  const [search, setSearch] = useState('')
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set([sourceServerId]))

  const { data: servers = [] } = useQuery<Server[]>({
    queryKey: ['my_servers'],
    queryFn: () => api.get('/servers').then(r => r.data),
    staleTime: 30_000,
  })

  // Fetch channels pour tous les serveurs où on est membre
  const { data: channelsByServer = {} } = useQuery<Record<string, Channel[]>>({
    queryKey: ['all_channels_for_forward', servers.map(s => s.id)],
    queryFn: async () => {
      const results = await Promise.all(
        servers.map(async (s) => {
          const channels = await api.get(`/servers/${s.id}/channels`).then(r => r.data as Channel[])
          return { serverId: s.id, channels }
        })
      )
      const map: Record<string, Channel[]> = {}
      results.forEach(({ serverId, channels }) => {
        map[serverId] = channels.filter((c: Channel) => c.type === 'text')
      })
      return map
    },
    enabled: servers.length > 0,
    staleTime: 30_000,
  })

  const forwardMutation = useMutation({
    // Un seul segment (message_id) -- le backend résout le message source dans
    // messages OU dm_messages ; sourceServerId/sourceChannelId n'existent pas
    // en contexte DM (serverId="" transmis par MessageList), donc jamais utilisés
    // ici pour construire l'URL (uniquement pour l'UX d'auto-expansion ci-dessus).
    // Salon cible chiffré : copie chiffrée pour lui (jamais de clair) ; sinon texte déchiffré si la source est chiffrée.
    mutationFn: async (destChannelId: string) => {
      if (await mustEncrypt('channel', destChannelId)) {
        const sealed = sourceText ? await seal('channel', destChannelId, sourceText) : null
        if (!sealed) throw new Error('E2E_LOCKED')
        return api.post(`/messages/${messageId}/forward`, { channel_id: destChannelId, ...sealed })
      }
      return api.post(`/messages/${messageId}/forward`, { channel_id: destChannelId, content: plaintext ?? undefined })
    },
    onSuccess: () => {
      toast.success(t('forward.done'))
      onClose()
    },
    onError: (e: any) => toast.error(sendErrorText(e, e.response?.data?.error ?? t('forward.error'))),
  })
  const { data: destEncrypted } = useQuery({
    queryKey: ['e2e_channel_forward', selectedChannelId],
    queryFn: () => mustEncrypt('channel', selectedChannelId!),
    enabled: !!selectedChannelId,
  })

  // Filtre par recherche
  const filteredServers = useMemo(() => {
    if (!search.trim()) return servers
    const q = search.toLowerCase()
    return servers.filter(s => {
      if (s.name.toLowerCase().includes(q)) return true
      const channels = channelsByServer[s.id] ?? []
      return channels.some(c => c.name.toLowerCase().includes(q))
    })
  }, [servers, channelsByServer, search])

  const toggleServer = (serverId: string) => {
    setExpandedServers(prev => {
      const next = new Set(prev)
      if (next.has(serverId)) next.delete(serverId)
      else next.add(serverId)
      return next
    })
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-4"
      onClick={onClose}
    >
      <div
        className="bg-fc-channel border border-fc-hover rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[80dvh]"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="forward-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-fc-hover flex-shrink-0">
          <h2 id="forward-modal-title" className="text-sm font-semibold text-white flex items-center gap-2">
            <Send size={14} className="text-fc-accent" />
            {t('forward.title')}
          </h2>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="p-1 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"
          >
            <X size={16} />
          </button>
        </div>

        {destEncrypted
          ? <p className="px-4 pt-3 text-xs text-fc-muted">{t('e2e.forward.encrypted')}</p>
          : plaintext != null && <p className="px-4 pt-3 text-xs text-fc-yellow">{t('e2e.forward.notice')}</p>}

        {/* Barre de recherche */}
        <div className="px-4 py-2 border-b border-fc-hover flex-shrink-0">
          <div className="flex items-center gap-2 bg-fc-input rounded-lg px-3 py-1.5">
            <Search size={14} className="text-fc-muted flex-shrink-0" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('forward.search')}
              aria-label={t('forward.search')}
              inputMode="search" autoComplete="off"
              enterKeyHint="search"
              autoCapitalize="none"
              className="flex-1 bg-transparent text-fc-text placeholder-fc-muted outline-none text-sm"
              autoFocus
            />
            {search && (
              <button onClick={() => setSearch('')} aria-label={t('settings.clearSearch')} className="text-fc-muted hover:text-white">
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Liste serveurs + canaux */}
        <div className="flex-1 overflow-y-auto overscroll-contain py-2">
          {filteredServers.length === 0 && (
            <div className="text-center text-fc-muted text-sm py-8">{t('forward.noResult')}</div>
          )}
          {filteredServers.map(server => {
            const channels = (channelsByServer[server.id] ?? []).filter(c =>
              !search.trim() || c.name.toLowerCase().includes(search.toLowerCase())
            )
            const isExpanded = expandedServers.has(server.id)

            return (
              <div key={server.id}>
                {/* En-tête serveur */}
                <button
                  onClick={() => toggleServer(server.id)}
                  className="w-full flex items-center gap-2 px-4 py-1.5 hover:bg-fc-hover/40 transition text-left"
                >
                  {isExpanded
                    ? <ChevronDown size={12} className="text-fc-muted flex-shrink-0" />
                    : <ChevronRight size={12} className="text-fc-muted flex-shrink-0" />
                  }
                  {server.icon ? (
                    <img src={mediaUrl(server.icon)} alt="" loading="lazy" decoding="async" className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-fc-accent flex items-center justify-center text-xs text-white font-bold flex-shrink-0">
                      {server.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="text-xs font-semibold text-fc-muted uppercase tracking-wide truncate">
                    {server.name}
                  </span>
                </button>

                {/* Canaux */}
                {isExpanded && channels.map(channel => {
                  const isSelected = selectedChannelId === channel.id
                  const isSameChannel = channel.id === sourceChannelId

                  return (
                    <button
                      key={channel.id}
                      onClick={() => !isSameChannel && setSelectedChannelId(channel.id)}
                      disabled={isSameChannel}
                      className={`w-full flex items-center gap-2 px-8 py-1.5 text-left transition
                        ${isSameChannel ? 'opacity-40 cursor-not-allowed' : 'hover:bg-fc-hover/40 cursor-pointer'}
                        ${isSelected ? 'bg-fc-accent/20 text-white' : 'text-fc-muted'}`}
                    >
                      <Hash size={14} className="flex-shrink-0" />
                      <span className="text-sm truncate">{channel.name}</span>
                      {isSameChannel && (
                        <span className="text-xs text-fc-muted ml-auto">{t('forward.current')}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-fc-hover flex items-center justify-between flex-shrink-0">
          <div className="text-xs text-fc-muted">
            {selectedChannelId
              ? t('forward.selected')
              : t('forward.pick')}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded text-sm text-fc-muted hover:text-white hover:bg-fc-hover transition"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => selectedChannelId && forwardMutation.mutate(selectedChannelId)}
              disabled={!selectedChannelId || forwardMutation.isPending}
              className="px-3 py-1.5 rounded text-sm btn-primary disabled:opacity-40 flex items-center gap-1.5"
            >
              <Send size={13} />
              {forwardMutation.isPending ? t('forward.sending') : t('forward.submit')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
