import { useState, useEffect } from 'react'
import { Shield, X, Plus } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client'
import toast from 'react-hot-toast'

interface Server {
  id: string
}

interface AutoModConfig {
  enabled: boolean
  blocked_words: string[]
  max_mentions: number
  max_links: number
  anti_spam: boolean
  anti_caps: boolean
}

interface Props {
  server: Server
  channels?: unknown[]
}

const DEFAULT: AutoModConfig = {
  enabled: false,
  blocked_words: [],
  max_mentions: 0,
  max_links: 0,
  anti_spam: false,
  anti_caps: false,
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`w-11 h-6 rounded-full transition relative flex-shrink-0 ${checked ? 'bg-fc-green' : 'bg-fc-muted'}`}
      role="switch"
      aria-checked={checked}
    >
      <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${checked ? 'left-6' : 'left-1'}`} />
    </button>
  )
}

export default function AutoModTab({ server }: Props) {
  const qc = useQueryClient()
  const [local, setLocal] = useState<AutoModConfig>(DEFAULT)
  const [wordInput, setWordInput] = useState('')

  const { data, isLoading } = useQuery<AutoModConfig>({
    queryKey: ['automod', server.id],
    queryFn: () => api.get(`/servers/${server.id}/automod`).then(r => r.data),
    staleTime: 60_000,
    retry: false,
  })

  useEffect(() => {
    if (data) setLocal({ ...DEFAULT, ...data })
  }, [data])

  const save = useMutation({
    mutationFn: () => api.put(`/servers/${server.id}/automod`, local),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automod', server.id] })
      toast.success('AutoMod sauvegardé')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur sauvegarde'),
  })

  const addWord = () => {
    const w = wordInput.trim().toLowerCase()
    if (!w) return
    if (local.blocked_words.includes(w)) { setWordInput(''); return }
    if (local.blocked_words.length >= 100) { toast.error('Maximum 100 mots'); return }
    setLocal(p => ({ ...p, blocked_words: [...p.blocked_words, w] }))
    setWordInput('')
  }

  const removeWord = (w: string) =>
    setLocal(p => ({ ...p, blocked_words: p.blocked_words.filter(x => x !== w) }))

  if (isLoading) return <div className="text-center text-fc-muted py-10 text-sm">Chargement...</div>

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
          <Shield size={18} className="text-fc-accent" />
          Auto-modération
        </h3>
        <p className="text-sm text-fc-muted mb-5">
          Filtrez automatiquement les messages selon des règles configurables.
        </p>

        {/* Activation globale */}
        <div className="flex items-center justify-between p-4 bg-fc-channel rounded-lg mb-5">
          <div>
            <div className="font-medium text-white text-sm">Activer l'AutoMod</div>
            <div className="text-xs text-fc-muted mt-0.5">Active l'ensemble des règles de modération automatique</div>
          </div>
          <Toggle checked={local.enabled} onChange={v => setLocal(p => ({ ...p, enabled: v }))} />
        </div>

        {/* Mots bloqués */}
        <div className="mb-5">
          <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3">
            Mots bloqués ({local.blocked_words.length}/100)
          </label>
          {local.blocked_words.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {local.blocked_words.map(w => (
                <span key={w} className="flex items-center gap-1.5 px-2.5 py-1 bg-fc-channel rounded-full text-sm text-white">
                  {w}
                  <button onClick={() => removeWord(w)} className="text-fc-muted hover:text-white transition">
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              value={wordInput}
              onChange={e => setWordInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addWord() } }}
              placeholder="Ajouter un mot à bloquer..."
              maxLength={100}
              className="flex-1 px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
            />
            <button
              onClick={addWord}
              disabled={!wordInput.trim() || local.blocked_words.length >= 100}
              className="flex items-center gap-1.5 px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition disabled:opacity-50"
            >
              <Plus size={14} />
              Ajouter
            </button>
          </div>
        </div>

        {/* Protections */}
        <div className="space-y-3 mb-5">
          <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide">Protections</label>
          <div className="flex items-center justify-between p-4 bg-fc-channel rounded-lg">
            <div>
              <div className="font-medium text-white text-sm">Anti-spam</div>
              <div className="text-xs text-fc-muted mt-0.5">Bloque les messages identiques répétés rapidement</div>
            </div>
            <Toggle checked={local.anti_spam} onChange={v => setLocal(p => ({ ...p, anti_spam: v }))} />
          </div>
          <div className="flex items-center justify-between p-4 bg-fc-channel rounded-lg">
            <div>
              <div className="font-medium text-white text-sm">Anti-CAPS</div>
              <div className="text-xs text-fc-muted mt-0.5">Bloque les messages entièrement en majuscules</div>
            </div>
            <Toggle checked={local.anti_caps} onChange={v => setLocal(p => ({ ...p, anti_caps: v }))} />
          </div>
        </div>

        {/* Limites */}
        <div className="space-y-3 mb-6">
          <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide">Limites par message</label>
          <div className="p-4 bg-fc-channel rounded-lg">
            <div className="flex justify-between items-center mb-1">
              <span className="text-sm text-white">Max mentions</span>
              <span className="text-sm font-semibold text-fc-accent">{local.max_mentions === 0 ? 'Désactivé' : `${local.max_mentions}`}</span>
            </div>
            <input type="range" min={0} max={20} value={local.max_mentions}
              onChange={e => setLocal(p => ({ ...p, max_mentions: Number(e.target.value) }))}
              className="w-full accent-indigo-500" />
          </div>
          <div className="p-4 bg-fc-channel rounded-lg">
            <div className="flex justify-between items-center mb-1">
              <span className="text-sm text-white">Max liens</span>
              <span className="text-sm font-semibold text-fc-accent">{local.max_links === 0 ? 'Désactivé' : `${local.max_links}`}</span>
            </div>
            <input type="range" min={0} max={10} value={local.max_links}
              onChange={e => setLocal(p => ({ ...p, max_links: Number(e.target.value) }))}
              className="w-full accent-indigo-500" />
          </div>
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
