import { useEffect, useState } from 'react'
import { RefreshCw, X, Plus, Unlink, ExternalLink } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../../api/client'
import { useT, intlLocale } from '../../i18n'
import { confirm } from '../ui/ConfirmModal'
import DiscordSyncTree from './DiscordSyncTree'
import { type SyncTree, initialSelection, toPayload } from '../../lib/discordSyncTree'

// Synchronisation périodique Discord -> ForgeChat (serveur : handlers/discord_import/sync.rs).
// Le jeton du bot n'est jamais renvoyé par l'API : seul `has_token` indique sa présence.

interface SyncConfig {
  configured: boolean
  guild_id: string
  has_token: boolean
  interval_hours: 24 | 48
  excluded_categories: string[]
  enabled: boolean
  sync_emojis: boolean
  sync_mode: 'full' | 'content'
  auto_include_new: boolean
  next_sync_at: string | null
  last_sync_at: string | null
  last_status: 'ok' | 'partial' | 'error' | null
  last_error: string | null
  last_imported: number
  running: boolean
  guild_name?: string | null
}

const inputCls = 'w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm'
const labelCls = 'block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2'

// Même normalisation que sync_rules::fold_name : minuscules, sans accents ni décoration, sans « s » final.
function foldName(name: string): string {
  const s = name.toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]/gu, '')
  return s.length > 1 && s.endsWith('s') ? s.slice(0, -1) : s
}

const errMsg = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback

export default function DiscordSyncTab({ serverId }: { serverId: string }) {
  const t = useT()
  const qc = useQueryClient()
  const key = ['discord_sync', serverId]

  const { data: cfg } = useQuery<SyncConfig>({
    queryKey: key,
    queryFn: () => api.get(`/servers/${serverId}/discord-sync`).then(r => r.data),
    refetchInterval: q => (q.state.data?.running ? 5000 : false),
  })

  const [guildId, setGuildId] = useState('')
  const [token, setToken] = useState('')
  const [intervalHours, setIntervalHours] = useState<24 | 48>(24)
  const [enabled, setEnabled] = useState(false)
  const [syncEmojis, setSyncEmojis] = useState(true)
  const [excluded, setExcluded] = useState<string[]>([])
  const [newRule, setNewRule] = useState('')
  const [syncMode, setSyncMode] = useState<'full' | 'content'>('full')
  const [autoNew, setAutoNew] = useState(true)
  const [tree, setTree] = useState<SyncTree | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [loaded, setLoaded] = useState(false)

  // Formulaire initialisé une fois depuis la configuration enregistrée.
  useEffect(() => {
    if (!cfg || loaded) return
    setGuildId(cfg.guild_id)
    setIntervalHours(cfg.interval_hours === 48 ? 48 : 24)
    setEnabled(cfg.enabled)
    setSyncEmojis(cfg.sync_emojis)
    setExcluded(cfg.excluded_categories)
    setSyncMode(cfg.sync_mode === 'content' ? 'content' : 'full')
    setAutoNew(cfg.auto_include_new !== false)
    setLoaded(true)
  }, [cfg, loaded])

  const save = useMutation({
    mutationFn: () => api.put(`/servers/${serverId}/discord-sync`, {
      guild_id: guildId.trim(),
      bot_token: token.trim() || undefined,
      interval_hours: intervalHours,
      excluded_categories: excluded,
      enabled,
      sync_emojis: syncEmojis,
      sync_mode: syncMode,
      auto_include_new: autoNew,
      // Sélection envoyée seulement si l'arbre a été chargé : sinon l'enregistrée est conservée.
      ...(tree ? toPayload(tree, sel) : {}),
    }).then(r => r.data as SyncConfig),
    onSuccess: data => {
      setToken('')
      qc.setQueryData(key, data)
      toast.success(data.guild_name ? t('dsync.savedGuild', { name: data.guild_name }) : t('dsync.saved'))
    },
    onError: e => toast.error(errMsg(e, t('common.error'))),
  })

  const loadTree = useMutation({
    mutationFn: () => api.get(`/servers/${serverId}/discord-sync/tree`).then(r => r.data as SyncTree),
    onSuccess: data => {
      setTree(data)
      setSel(initialSelection(data))
    },
    onError: e => toast.error(errMsg(e, t('common.error'))),
  })

  const runNow = useMutation({
    mutationFn: () => api.post(`/servers/${serverId}/discord-sync/run`),
    onSuccess: () => {
      toast.success(t('dsync.started'))
      qc.setQueryData<SyncConfig>(key, old => (old ? { ...old, running: true } : old))
      setTimeout(() => qc.invalidateQueries({ queryKey: key }), 1500)
    },
    onError: e => toast.error(errMsg(e, t('common.error'))),
  })

  const unlink = useMutation({
    mutationFn: () => api.delete(`/servers/${serverId}/discord-sync`),
    onSuccess: () => {
      toast.success(t('dsync.unlinked'))
      setLoaded(false)
      setTree(null)
      qc.invalidateQueries({ queryKey: key })
    },
    onError: e => toast.error(errMsg(e, t('common.error'))),
  })

  const addRule = () => {
    const r = newRule.trim()
    if (r && !excluded.includes(r) && excluded.length < 50) setExcluded([...excluded, r])
    setNewRule('')
  }
  const ruleLabel = (r: string) => r

  const fmt = (d: string) => new Date(d).toLocaleString(intlLocale())
  const guildValid = /^\d{15,21}$/.test(guildId.trim())
  const canSave = guildValid && (!enabled || cfg?.has_token || token.trim().length > 0)

  if (!cfg) return <div role="status" className="text-center text-fc-muted py-10 text-sm">{t('common.loading')}</div>

  let status = t('dsync.never')
  if (cfg.last_sync_at) {
    const vars = { when: fmt(cfg.last_sync_at), n: cfg.last_imported }
    status = cfg.last_status === 'error' ? t('dsync.statusError', vars)
      : cfg.last_status === 'partial' ? t('dsync.statusPartial', vars)
      : t('dsync.statusOk', vars)
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-white mb-1">{t('dsync.title')}</h3>
        <p className="text-sm text-fc-muted mb-2">{t('dsync.intro')}</p>
        <p className="text-xs text-fc-muted mb-2">{t('dsync.howto')}</p>
        <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-fc-accent hover:underline">
          <ExternalLink size={12} aria-hidden /> {t('dsync.portal')}
        </a>
      </div>

      {/* État */}
      <div className="p-3 bg-fc-channel rounded-lg text-sm space-y-1" role="status" aria-live="polite">
        <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide">{t('dsync.status')}</div>
        {cfg.running
          ? <div className="text-white flex items-center gap-2"><RefreshCw size={14} className="animate-spin" aria-hidden />{t('dsync.running')}</div>
          : <div className={cfg.last_status === 'error' ? 'text-red-400' : 'text-white'}>{status}</div>}
        {cfg.last_error && !cfg.running && <div className="text-xs text-amber-300 break-words">{cfg.last_error}</div>}
        {cfg.enabled && cfg.next_sync_at && !cfg.running && (
          <div className="text-xs text-fc-muted">{t('dsync.next', { when: fmt(cfg.next_sync_at) })}</div>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <label className={labelCls} htmlFor="dsync-guild">{t('dsync.guildId')}</label>
          <input id="dsync-guild" value={guildId} onChange={e => setGuildId(e.target.value)} inputMode="numeric"
            placeholder={t('dsync.guildIdPh')} maxLength={21} autoComplete="off" className={`${inputCls} font-mono`} />
        </div>
        <div>
          <label className={labelCls} htmlFor="dsync-token">{t('dsync.token')}</label>
          <input id="dsync-token" type="password" value={token} onChange={e => setToken(e.target.value)}
            placeholder={t('dsync.tokenPh')} maxLength={200} autoComplete="off" spellCheck={false} className={`${inputCls} font-mono`} />
          {cfg.has_token && <p className="text-xs text-fc-muted mt-1">{t('dsync.tokenKeep')}</p>}
        </div>

        <label className="flex items-center gap-2 text-sm text-white cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="accent-fc-accent" />
          {t('dsync.enabled')}
        </label>

        <div>
          <label className={labelCls} htmlFor="dsync-interval">{t('dsync.interval')}</label>
          <select id="dsync-interval" value={intervalHours} onChange={e => setIntervalHours(e.target.value === '48' ? 48 : 24)} className={inputCls}>
            <option value={24}>{t('dsync.daily')}</option>
            <option value={48}>{t('dsync.every2')}</option>
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm text-white cursor-pointer">
          <input type="checkbox" checked={syncEmojis} onChange={e => setSyncEmojis(e.target.checked)} className="accent-fc-accent" />
          {t('dsync.emojis')}
        </label>

        {/* Mode de synchronisation */}
        <fieldset className="min-w-0">
          <legend className={labelCls}>{t('dsync.mode')}</legend>
          {(['full', 'content'] as const).map(m => (
            <label key={m} className="flex items-start gap-2 text-sm text-white cursor-pointer mb-2">
              <input type="radio" name="dsync-mode" checked={syncMode === m} onChange={() => setSyncMode(m)} className="accent-fc-accent mt-1" />
              <span>
                <span className="font-medium">{t(m === 'full' ? 'dsync.modeFull' : 'dsync.modeContent')}</span>
                <span className="block text-xs text-fc-muted">{t(m === 'full' ? 'dsync.modeFullHint' : 'dsync.modeContentHint')}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {/* Éléments à synchroniser */}
        <fieldset className="min-w-0">
          <legend className={labelCls}>{t('dsync.items')}</legend>
          <p className="text-xs text-fc-muted mb-2">{t('dsync.itemsHint')}</p>
          <label className="flex items-start gap-2 text-sm text-white cursor-pointer mb-2">
            <input type="checkbox" checked={autoNew} onChange={e => setAutoNew(e.target.checked)} className="accent-fc-accent mt-1" />
            <span>
              {t('dsync.autoNew')}
              <span className="block text-xs text-fc-muted">{t('dsync.autoNewHint')}</span>
            </span>
          </label>
          {cfg.has_token && (
            <button type="button" onClick={() => loadTree.mutate()} disabled={loadTree.isPending} aria-busy={loadTree.isPending}
              className="mb-2 text-xs text-fc-accent hover:underline disabled:opacity-50">
              {loadTree.isPending ? t('common.loading') : tree ? t('dsync.reloadTree') : t('dsync.loadTree')}
            </button>
          )}
          {loadTree.isError && <p role="alert" className="text-xs text-red-400 mb-2">{t('dsync.treeError')}</p>}
          {tree && <DiscordSyncTree tree={tree} sel={sel} onChange={setSel} />}
        </fieldset>

        {/* Exclusion par nom */}
        <fieldset className="min-w-0">
          <legend className={labelCls}>{t('dsync.excluded')}</legend>
          <p className="text-xs text-fc-muted mb-2">{t('dsync.excludedHint')}</p>
          <div className="flex flex-wrap gap-2 mb-2">
            {excluded.map(r => (
              <span key={r} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-fc-channel text-xs text-white">
                {ruleLabel(r)}
                <button type="button" onClick={() => setExcluded(excluded.filter(x => x !== r))}
                  aria-label={t('dsync.remove', { name: ruleLabel(r) })} className="text-fc-muted hover:text-white">
                  <X size={12} aria-hidden />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={newRule} onChange={e => setNewRule(e.target.value)} maxLength={100}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRule() } }}
              placeholder={t('dsync.addExcluded')} aria-label={t('dsync.addExcluded')} className={inputCls} />
            <button type="button" onClick={addRule} disabled={!newRule.trim()}
              className="flex items-center gap-1 px-3 py-2 bg-fc-hover hover:bg-fc-hover/70 text-white rounded text-sm disabled:opacity-50">
              <Plus size={14} aria-hidden /> {t('dsync.add')}
            </button>
          </div>
        </fieldset>

        <p className="text-xs text-fc-muted">{t('dsync.e2eNote')}</p>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => save.mutate()} disabled={!canSave || save.isPending} aria-busy={save.isPending}
            className="px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition disabled:opacity-50">
            {save.isPending ? t('dsync.saving') : t('dsync.save')}
          </button>
          {cfg.has_token && (
            <button type="button" onClick={() => runNow.mutate()} disabled={cfg.running || runNow.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-fc-hover hover:bg-fc-hover/70 text-white rounded text-sm font-medium transition disabled:opacity-50">
              <RefreshCw size={14} aria-hidden /> {t('dsync.syncNow')}
            </button>
          )}
          {cfg.configured && (
            <button type="button" onClick={() => { void confirm({ message: t('dsync.unlinkConfirm'), danger: true, confirmLabel: t('dsync.unlink') }).then(ok => { if (ok) unlink.mutate() }) }}
              disabled={unlink.isPending}
              className="flex items-center gap-2 px-4 py-2 text-red-400 hover:bg-red-500/10 rounded text-sm font-medium transition disabled:opacity-50">
              <Unlink size={14} aria-hidden /> {t('dsync.unlink')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
