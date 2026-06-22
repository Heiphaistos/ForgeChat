import { useState, useEffect } from 'react'
import { Shield, X, Plus } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../api/client'
import toast from 'react-hot-toast'

interface Props {
  serverId: string
}

interface AutoModConfig {
  enabled: boolean
  blocked_words: string[]
  max_mentions: number
  max_links: number
  anti_spam: boolean
  anti_caps: boolean
}

const DEFAULT_CONFIG: AutoModConfig = {
  enabled: false,
  blocked_words: [],
  max_mentions: 0,
  max_links: 0,
  anti_spam: false,
  anti_caps: false,
}

interface ToggleRowProps {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
}

function ToggleRow({ label, description, checked, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between p-4 bg-fc-channel rounded-lg">
      <div className="min-w-0 pr-4">
        <div className="font-medium text-white text-sm">{label}</div>
        <div className="text-xs text-fc-muted mt-0.5">{description}</div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`w-11 h-6 rounded-full transition relative flex-shrink-0 ${checked ? 'bg-fc-green' : 'bg-fc-muted'}`}
        role="switch"
        aria-checked={checked}
      >
        <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${checked ? 'left-6' : 'left-1'}`} />
      </button>
    </div>
  )
}

interface SliderRowProps {
  label: string
  description: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  zeroLabel?: string
  onChange: (v: number) => void
}

function SliderRow({ label, description, value, min, max, step = 1, unit = '', zeroLabel = 'Désactivé', onChange }: SliderRowProps) {
  const pct = max > 0 ? ((value - min) / (max - min)) * 100 : 0
  return (
    <div className="p-4 bg-fc-channel rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="font-medium text-white text-sm">{label}</div>
          <div className="text-xs text-fc-muted mt-0.5">{description}</div>
        </div>
        <span className="text-sm font-semibold text-fc-accent ml-4 flex-shrink-0 w-20 text-right">
          {value === 0 ? zeroLabel : `${value}${unit}`}
        </span>
      </div>
      <div className="relative mt-3">
        <div className="w-full h-2 bg-fc-hover rounded-full overflow-hidden">
          <div
            className="h-full bg-fc-accent rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer h-2"
        />
      </div>
      <div className="flex justify-between mt-1 text-xs text-fc-muted">
        <span>{zeroLabel}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  )
}

export default function AutoModPage({ serverId }: Props) {
  const qc = useQueryClient()
  const [local, setLocal] = useState<AutoModConfig>(DEFAULT_CONFIG)
  const [wordInput, setWordInput] = useState('')

  const { data, isLoading } = useQuery<AutoModConfig>({
    queryKey: ['automod', serverId],
    queryFn: () => api.get(`/servers/${serverId}/automod`).then(r => r.data),
  })

  useEffect(() => {
    if (data) setLocal(data)
  }, [data])

  const save = useMutation({
    mutationFn: () => api.put(`/servers/${serverId}/automod`, local),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automod', serverId] })
      toast.success('AutoMod sauvegardé')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur sauvegarde'),
  })

  const addWord = () => {
    const w = wordInput.trim().toLowerCase()
    if (!w) return
    if (local.blocked_words.includes(w)) {
      toast.error('Ce mot est déjà dans la liste')
      setWordInput('')
      return
    }
    if (local.blocked_words.length >= 100) {
      toast.error('Maximum 100 mots bloqués')
      return
    }
    setLocal(p => ({ ...p, blocked_words: [...p.blocked_words, w] }))
    setWordInput('')
  }

  const removeWord = (w: string) =>
    setLocal(p => ({ ...p, blocked_words: p.blocked_words.filter(x => x !== w) }))

  if (isLoading) {
    return <div className="text-center text-fc-muted py-12 text-sm">Chargement...</div>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
          <Shield size={18} className="text-fc-accent" />
          AutoMod
        </h3>
        <p className="text-sm text-fc-muted">
          Filtrez et modérez automatiquement les messages selon des règles configurables.
        </p>
      </div>

      {/* Toggle global */}
      <ToggleRow
        label="Activer AutoMod"
        description="Active l'ensemble des règles de modération automatique"
        checked={local.enabled}
        onChange={v => setLocal(p => ({ ...p, enabled: v }))}
      />

      {/* Mots bloqués */}
      <div>
        <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3">
          Mots bloqués
          <span className="ml-2 normal-case font-normal">({local.blocked_words.length}/100)</span>
        </label>

        {/* Tags */}
        {local.blocked_words.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {local.blocked_words.map(w => (
              <span
                key={w}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-fc-channel rounded-full text-sm text-white"
              >
                {w}
                <button
                  onClick={() => removeWord(w)}
                  className="text-fc-muted hover:text-white transition flex-shrink-0"
                  aria-label={`Supprimer le mot ${w}`}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}

        {local.blocked_words.length === 0 && (
          <p className="text-xs text-fc-muted mb-3">Aucun mot bloqué pour l'instant.</p>
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

      {/* Limites */}
      <div className="space-y-3">
        <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide">
          Limites par message
        </label>
        <SliderRow
          label="Max mentions par message"
          description="Bloque les messages avec trop de @mentions"
          value={local.max_mentions}
          min={0}
          max={20}
          unit=" mentions"
          zeroLabel="Désactivé"
          onChange={v => setLocal(p => ({ ...p, max_mentions: v }))}
        />
        <SliderRow
          label="Max liens par message"
          description="Bloque les messages avec trop de liens URL"
          value={local.max_links}
          min={0}
          max={10}
          unit=" liens"
          zeroLabel="Désactivé"
          onChange={v => setLocal(p => ({ ...p, max_links: v }))}
        />
      </div>

      {/* Protections */}
      <div className="space-y-3">
        <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide">
          Protections
        </label>
        <ToggleRow
          label="Anti-spam"
          description="Bloque les messages identiques envoyés rapidement à la suite"
          checked={local.anti_spam}
          onChange={v => setLocal(p => ({ ...p, anti_spam: v }))}
        />
        <ToggleRow
          label="Anti-CAPS"
          description="Bloque les messages écrits entièrement en majuscules"
          checked={local.anti_caps}
          onChange={v => setLocal(p => ({ ...p, anti_caps: v }))}
        />
      </div>

      {/* Bouton sauvegarder */}
      <div className="pt-2">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="px-5 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded font-medium text-sm transition disabled:opacity-50"
        >
          {save.isPending ? 'Sauvegarde...' : 'Sauvegarder les règles AutoMod'}
        </button>
      </div>
    </div>
  )
}
