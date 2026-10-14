import { useState, useEffect } from 'react'
import { useT, t as tr } from '../i18n'
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
        aria-label={label}
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

function SliderRow({ label, description, value, min, max, step = 1, unit = '', zeroLabel = tr('hc.am.off'), onChange }: SliderRowProps) {
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
          aria-label={label}
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
  const t = useT()
  const qc = useQueryClient()
  const [local, setLocal] = useState<AutoModConfig>(DEFAULT_CONFIG)
  const [wordInput, setWordInput] = useState('')

  const { data, isLoading, isError } = useQuery<AutoModConfig>({
    queryKey: ['automod', serverId],
    queryFn: () => api.get(`/servers/${serverId}/automod`).then(r => r.data),
  })

  useEffect(() => {
    if (data) setLocal({
      enabled: data.enabled ?? false,
      blocked_words: data.blocked_words ?? [],
      max_mentions: data.max_mentions ?? 0,
      max_links: data.max_links ?? 0,
      anti_spam: data.anti_spam ?? false,
      anti_caps: data.anti_caps ?? false,
    })
  }, [data])

  const save = useMutation({
    mutationFn: () => api.put(`/servers/${serverId}/automod`, local),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automod', serverId] })
      toast.success(t('hc.am.saved'))
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('hc.am.saveFail')),
  })

  const addWord = () => {
    const w = wordInput.trim().toLowerCase()
    if (!w) return
    if (local.blocked_words.includes(w)) {
      toast.error(t('hc.am.dup'))
      setWordInput('')
      return
    }
    if (local.blocked_words.length >= 100) {
      toast.error(t('hc.am.max'))
      return
    }
    setLocal(p => ({ ...p, blocked_words: [...p.blocked_words, w] }))
    setWordInput('')
  }

  const removeWord = (w: string) =>
    setLocal(p => ({ ...p, blocked_words: p.blocked_words.filter(x => x !== w) }))

  if (isLoading) {
    return <div className="text-center text-fc-muted py-12 text-sm">{t('common.loading')}</div>
  }

  if (isError) {
    return (
      <div className="text-center py-12">
        <Shield size={40} className="mx-auto text-fc-muted/30 mb-3" />
        <p className="text-fc-muted text-sm">{t('hc.am.loadFail')}</p>
        <p className="text-fc-muted/60 text-xs mt-1">{t('hc.am.perm')}</p>
      </div>
    )
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
          {t('hc.am.intro')}
        </p>
      </div>

      {/* Toggle global */}
      <ToggleRow
        label={t('hc.am.enable')}
        description={t('hc.am.enableDesc')}
        checked={local.enabled}
        onChange={v => setLocal(p => ({ ...p, enabled: v }))}
      />

      {/* Mots bloqués */}
      <div>
        <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3">
          {t('hc.am.words')}
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
                  aria-label={t('hc.am.removeWord', { w })}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}

        {local.blocked_words.length === 0 && (
          <p className="text-xs text-fc-muted mb-3">{t('hc.am.noWords')}</p>
        )}

        <div className="flex gap-2">
          <input
            value={wordInput}
            onChange={e => setWordInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addWord() } }}
            placeholder={t('hc.am.addPh')}
            maxLength={100}
            enterKeyHint="done"
            autoCapitalize="none"
            className="flex-1 px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
          />
          <button
            onClick={addWord}
            disabled={!wordInput.trim() || local.blocked_words.length >= 100}
            className="flex items-center gap-1.5 px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition disabled:opacity-50"
          >
            <Plus size={14} />
            {t('hc.am.add')}
          </button>
        </div>
      </div>

      {/* Limites */}
      <div className="space-y-3">
        <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide">
          {t('hc.am.limits')}
        </label>
        <SliderRow
          label={t('hc.am.maxMent')}
          description={t('hc.am.maxMentDesc')}
          value={local.max_mentions}
          min={0}
          max={20}
          unit={t('hc.am.mentions')}
          zeroLabel={t('hc.am.off')}
          onChange={v => setLocal(p => ({ ...p, max_mentions: v }))}
        />
        <SliderRow
          label={t('hc.am.maxLinks')}
          description={t('hc.am.maxLinksDesc')}
          value={local.max_links}
          min={0}
          max={10}
          unit={t('hc.am.links')}
          zeroLabel={t('hc.am.off')}
          onChange={v => setLocal(p => ({ ...p, max_links: v }))}
        />
      </div>

      {/* Protections */}
      <div className="space-y-3">
        <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide">
          {t('hc.am.protect')}
        </label>
        <ToggleRow
          label={t('hc.am.spam')}
          description={t('hc.am.spamDesc')}
          checked={local.anti_spam}
          onChange={v => setLocal(p => ({ ...p, anti_spam: v }))}
        />
        <ToggleRow
          label={t('hc.am.caps')}
          description={t('hc.am.capsDesc')}
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
          {save.isPending ? t('hc.am.saving') : t('hc.am.save')}
        </button>
      </div>
    </div>
  )
}
