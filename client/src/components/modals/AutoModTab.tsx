import { useState, useEffect } from 'react'
import { Shield, X, Plus } from 'lucide-react'
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
}

interface AutoModConfig {
  enabled: boolean
  word_filter: string[]
  action: 'delete' | 'warn' | 'kick' | 'ban'
  log_channel_id: string | null
}

interface Props {
  server: Server
  channels: Channel[]
}

const ACTIONS: { value: AutoModConfig['action']; label: string; desc: string }[] = [
  { value: 'delete',  label: 'Supprimer',  desc: 'Supprime le message automatiquement' },
  { value: 'warn',    label: 'Avertir',    desc: 'Envoie un avertissement au membre' },
  { value: 'kick',    label: 'Expulser',   desc: 'Expulse le membre du serveur' },
  { value: 'ban',     label: 'Bannir',     desc: 'Bannit définitivement le membre' },
]

export default function AutoModTab({ server, channels }: Props) {
  const qc = useQueryClient()
  const [wordInput, setWordInput] = useState('')
  const [local, setLocal] = useState<AutoModConfig>({
    enabled: false,
    word_filter: [],
    action: 'delete',
    log_channel_id: null,
  })

  const textChannels = channels.filter(c => c.type === 'text')

  const { data, isLoading } = useQuery<AutoModConfig>({
    queryKey: ['automod', server.id],
    queryFn: () => api.get(`/servers/${server.id}/automod`).then(r => r.data),
    retry: false,
  })

  useEffect(() => {
    if (data) setLocal(data)
  }, [data])

  const save = useMutation({
    mutationFn: () => api.put(`/servers/${server.id}/automod`, local),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automod', server.id] })
      toast.success('Auto-modération mise à jour')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur sauvegarde'),
  })

  const addWord = () => {
    const w = wordInput.trim().toLowerCase()
    if (!w || local.word_filter.includes(w)) {
      setWordInput('')
      return
    }
    setLocal(p => ({ ...p, word_filter: [...p.word_filter, w] }))
    setWordInput('')
  }

  const removeWord = (w: string) => {
    setLocal(p => ({ ...p, word_filter: p.word_filter.filter(x => x !== w) }))
  }

  if (isLoading) {
    return <div className="text-center text-fc-muted py-10 text-sm">Chargement...</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
          <Shield size={18} className="text-fc-accent" />
          Auto-modération
        </h3>
        <p className="text-sm text-fc-muted mb-5">
          Filtrez automatiquement les messages contenant des mots interdits.
        </p>

        {/* Toggle activation */}
        <div className="flex items-center justify-between p-4 bg-fc-channel rounded-lg mb-5">
          <div>
            <div className="font-medium text-white text-sm">Activer l'auto-modération</div>
            <div className="text-xs text-fc-muted">Les messages détectés seront traités automatiquement</div>
          </div>
          <button
            onClick={() => setLocal(p => ({ ...p, enabled: !p.enabled }))}
            className={`w-11 h-6 rounded-full transition relative flex-shrink-0 ${local.enabled ? 'bg-fc-green' : 'bg-fc-muted'}`}
          >
            <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${local.enabled ? 'left-6' : 'left-1'}`} />
          </button>
        </div>

        {/* Mots filtrés */}
        <div className="mb-5">
          <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3">
            Mots filtrés ({local.word_filter.length})
          </label>

          {/* Tags */}
          {local.word_filter.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {local.word_filter.map(w => (
                <span key={w} className="flex items-center gap-1.5 px-2.5 py-1 bg-fc-channel rounded-full text-sm text-fc-text">
                  {w}
                  <button
                    onClick={() => removeWord(w)}
                    className="text-fc-muted hover:text-white transition"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Input ajout */}
          <div className="flex gap-2">
            <input
              value={wordInput}
              onChange={e => setWordInput(e.target.value)}
              placeholder="Ajouter un mot interdit..."
              className="flex-1 px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
              onKeyDown={e => { if (e.key === 'Enter') addWord() }}
              maxLength={100}
            />
            <button
              onClick={addWord}
              disabled={!wordInput.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition disabled:opacity-50"
            >
              <Plus size={14} />
              Ajouter
            </button>
          </div>
        </div>

        {/* Action */}
        <div className="mb-5">
          <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3">
            Action à effectuer
          </label>
          <div className="space-y-2">
            {ACTIONS.map(a => (
              <label key={a.value} className="flex items-start gap-3 p-3 bg-fc-channel rounded-lg cursor-pointer hover:bg-fc-hover/40 transition">
                <input
                  type="radio"
                  name="automod_action"
                  value={a.value}
                  checked={local.action === a.value}
                  onChange={() => setLocal(p => ({ ...p, action: a.value }))}
                  className="mt-0.5 accent-indigo-500"
                />
                <div>
                  <div className="text-white text-sm font-medium">{a.label}</div>
                  <div className="text-xs text-fc-muted">{a.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Canal de log */}
        <div className="mb-6">
          <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">
            Canal de journalisation (optionnel)
          </label>
          <select
            value={local.log_channel_id ?? ''}
            onChange={e => setLocal(p => ({ ...p, log_channel_id: e.target.value || null }))}
            className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
          >
            <option value="">Aucun canal</option>
            {textChannels.map(c => (
              <option key={c.id} value={c.id}>#{c.name}</option>
            ))}
          </select>
          <p className="text-xs text-fc-muted mt-1">Les actions de modération seront enregistrées dans ce canal.</p>
        </div>

        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="px-5 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded font-medium text-sm transition disabled:opacity-50"
        >
          {save.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
        </button>
      </div>
    </div>
  )
}
