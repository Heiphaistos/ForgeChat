// Réglages « IA sur l'appareil » : fonctions affichées, langue cible, modèles
// téléchargés (taille avant téléchargement, espace utilisé, suppression).
import { useCallback, useEffect, useState } from 'react'
import { Check, Download, Trash2 } from 'lucide-react'
import { Field, Select, Toggle } from './shared'
import { useT, type Key } from '../../i18n'
import { formatBytes } from '../../utils/compressImage'
import { AI_LANGS, PACKS, packSize, type AiLang, type PackId } from '../../ai/manifest'
import { installedPacks, removePacks, usedBytes } from '../../ai/modelStore'
import { download, stopEngine, useAiSettings } from '../../ai/engine'

const ORDER: PackId[] = ['runtime', 'whisper', 'whisper-small', 'romance-en', 'en-romance', 'de-en', 'en-de']

export default function AiSection() {
  const t = useT()
  const s = useAiSettings()
  const [have, setHave] = useState<Set<PackId>>(new Set())
  const [used, setUsed] = useState(0)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setHave(await installedPacks())
    setUsed(await usedBytes())
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try { await fn() } catch { /* erreur déjà signalée par une notification */ } finally { setBusy(false); void refresh() }
  }
  const remove = (ids: PackId[]) => run(async () => { stopEngine(); await removePacks(ids) })

  const row = (label: string, value: boolean, onChange: (v: boolean) => void, hint?: string) => (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm text-fc-text">{label}</p>
        {hint && <p className="text-xs text-fc-muted">{hint}</p>}
      </div>
      <Toggle value={value} onChange={onChange} label={label} />
    </div>
  )

  return (
    <div className="space-y-6">
      <p className="text-sm text-fc-muted">{t('ai.intro')}</p>
      <div className="space-y-3">
        {row(t('ai.set.translate'), s.translate, v => s.set({ translate: v }))}
        {row(t('ai.set.transcribe'), s.transcribe, v => s.set({ transcribe: v }))}
        {row(t('ai.set.precise'), s.precise, v => s.set({ precise: v }), t('ai.set.preciseHint'))}
        {row(t('ai.set.summary'), s.summary, v => s.set({ summary: v }), t('ai.set.summaryHint'))}
      </div>
      <Field label={t('ai.set.target')}>
        <Select
          value={s.target ?? ''}
          onChange={v => s.set({ target: (v || null) as AiLang | null })}
          className="w-full"
          options={[{ value: '', label: t('ai.set.targetAuto') }, ...AI_LANGS.map(l => ({ value: l, label: t(`ai.lang.${l}` as Key) }))]}
        />
      </Field>
      <Field label={t('ai.set.models')} hint={t('ai.set.used', { size: formatBytes(used) })}>
        <ul className="divide-y divide-fc-hover rounded-lg border border-fc-hover">
          {ORDER.map(id => (
            <li key={id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm text-fc-text truncate">{t(`ai.pack.${id}` as Key)}</p>
                <p className="text-xs text-fc-muted truncate">{PACKS[id].repo ?? 'onnxruntime-web'} · {PACKS[id].license}</p>
              </div>
              {have.has(id) ? (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="flex items-center gap-1 text-xs text-green-400"><Check size={12} aria-hidden /> {t('ai.set.installed')}</span>
                  <button type="button" disabled={busy} onClick={() => void remove([id])}
                    className="p-1.5 rounded text-fc-muted hover:text-red-400 hover:bg-fc-hover disabled:opacity-50"
                    aria-label={`${t('ai.set.delete')} — ${t(`ai.pack.${id}` as Key)}`}>
                    <Trash2 size={14} aria-hidden />
                  </button>
                </div>
              ) : (
                <button type="button" disabled={busy} onClick={() => void run(() => download(id === 'runtime' ? [id] : ['runtime', id]))}
                  className="flex items-center gap-1.5 flex-shrink-0 px-2.5 py-1.5 rounded bg-fc-accent/15 text-fc-accent text-xs font-medium hover:bg-fc-accent/25 disabled:opacity-50">
                  <Download size={12} aria-hidden /> {t('ai.set.download', { size: formatBytes(packSize(have.has('runtime') ? [id] : ['runtime', id])) })}
                </button>
              )}
            </li>
          ))}
        </ul>
      </Field>
      {used > 0 && (
        <button type="button" disabled={busy} onClick={() => void remove(ORDER)}
          className="w-full py-2 rounded-lg border border-red-500/40 text-red-400 text-sm hover:bg-red-500/10 disabled:opacity-50">
          {t('ai.set.deleteAll')}
        </button>
      )}
    </div>
  )
}
