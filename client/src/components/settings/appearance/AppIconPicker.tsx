// Choix de l'icône d'application (Apparence) : icône d'origine (logo 3D), icônes prédéfinies
// rangées par familles (recherche et filtres), ou import.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Upload } from 'lucide-react'
import toast from 'react-hot-toast'
import { useT, type Key } from '../../../i18n'
import { errText, isDesktop } from '../../../lib/desktop'
import { IconError, currentIcon, fetchPreset, importIcon, presetUrl, setAppIcon } from '../../../lib/appIcon'
import { PRESET_GROUPS } from '../../../lib/appIconPresets'
import Logo3D from '../../Logo3D'

const tile = (on: boolean) =>
  `w-11 h-11 rounded-lg p-0.5 border-2 transition ${on ? 'border-fc-accent' : 'border-transparent hover:border-fc-hover'}`
const chip = (on: boolean) =>
  `px-2 py-0.5 rounded-full text-xs border transition ${on ? 'bg-fc-accent text-white border-fc-accent' : 'border-fc-hover text-fc-muted hover:text-fc-text'}`
// Recherche sans accents ni casse (« neon » trouve « Néon »).
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const NAMES = new Map(PRESET_GROUPS.flatMap(g => g.presets.map(p => [p.n, p.name] as const)))

export default function AppIconPicker() {
  const t = useT()
  const [choice, setChoice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { void currentIcon().then(setChoice).catch(() => {}) }, [])

  const groupLabel = (id: string, fallback: string) => {
    const key = `appIcon.group.${id}` as Key
    const v = t(key)
    return v === key ? fallback : v
  }

  const presetName = (n: number, fallback: string) => {
    const key = `appIcon.p.${n}` as Key
    const v = t(key)
    return v === key ? fallback : v
  }

  const groups = useMemo(() => {
    const q = fold(query.trim())
    return PRESET_GROUPS
      .filter(g => group === null || g.id === group)
      .map(g => {
        const label = groupLabel(g.id, g.label)
        const inGroup = !q || fold(`${label} ${g.label}`).includes(q)
        const named = g.presets.map(p => ({ ...p, name: presetName(p.n, p.name), fr: p.name }))
        return { ...g, label, presets: inGroup ? named : named.filter(p => fold(`${p.name} ${p.fr}`).includes(q)) }
      })
      .filter(g => g.presets.length > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t suit la langue, groupLabel en dépend seul
  }, [query, group, t])

  const apply = async (id: string | null, png?: () => Promise<Blob>) => {
    setBusy(true)
    try {
      await setAppIcon(id, png ? await png() : undefined)
      setChoice(id)
      toast.success(t('appIcon.applied'))
    } catch (e) {
      toast.error(e instanceof IconError ? t(`appIcon.${e.code}`) : t('appIcon.failed', { e: errText(e) }))
    } finally {
      setBusy(false)
    }
  }

  const chosenN = choice?.startsWith('preset:') ? Number(choice.slice(7)) : null
  const chosenName = choice === null ? t('appIcon.default')
    : choice === 'custom' ? t('appIcon.custom')
    : NAMES.has(chosenN ?? 0) ? presetName(chosenN ?? 0, NAMES.get(chosenN ?? 0) ?? '') : t('appIcon.preset', { n: chosenN ?? 0 })

  return (
    <div className="space-y-3">
      <p className="text-xs text-fc-muted">{t('appIcon.hint')}</p>
      {isDesktop && /^Win/i.test(navigator.platform) && <p className="text-xs text-fc-muted">{t('appIcon.pinnedHint')}</p>}
      <p className="text-xs text-fc-muted">{t('appIcon.staticHint')}</p>

      <div className="flex items-center gap-3" role="radiogroup" aria-label={t('appIcon.title')}>
        <button type="button" role="radio" aria-checked={choice === null} disabled={busy} title={t('appIcon.default')}
          onClick={() => void apply(null)} className={`${tile(choice === null)} flex items-center justify-center`}>
          <Logo3D size={34} />
        </button>
        {choice === 'custom' && (
          <span role="radio" aria-checked title={t('appIcon.custom')} className={`${tile(true)} flex items-center justify-center text-[10px] text-fc-text`}>
            {t('appIcon.custom')}
          </span>
        )}
        <div className="min-w-0">
          <p className="text-sm text-fc-text truncate">{t('appIcon.current', { name: chosenName })}</p>
          <p className="text-xs text-fc-muted">{t('appIcon.animatedDefault')}</p>
        </div>
      </div>

      <div className="relative">
        <Search size={14} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fc-muted" />
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('appIcon.search')}
          aria-label={t('appIcon.search')}
          className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-fc-input text-sm text-fc-text placeholder:text-fc-muted outline-none focus:ring-2 focus:ring-fc-accent" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" aria-pressed={group === null} onClick={() => setGroup(null)} className={chip(group === null)}>
          {t('appIcon.all')}
        </button>
        {PRESET_GROUPS.map(g => (
          <button key={g.id} type="button" aria-pressed={group === g.id} onClick={() => setGroup(group === g.id ? null : g.id)}
            className={chip(group === g.id)}>
            {groupLabel(g.id, g.label)}
          </button>
        ))}
      </div>

      <div className="max-h-80 overflow-y-auto pr-1 space-y-3 rounded-lg" role="radiogroup" aria-label={t('appIcon.title')}>
        {groups.length === 0 && <p className="text-xs text-fc-muted py-4 text-center">{t('appIcon.none')}</p>}
        {groups.map(g => (
          <section key={g.id} aria-label={g.label}>
            <h4 className="sticky top-0 z-10 bg-fc-channel/95 py-1 text-[11px] font-semibold uppercase tracking-wide text-fc-muted">
              {g.label} <span className="font-normal normal-case">· {t('appIcon.count', { n: g.presets.length })}</span>
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {g.presets.map(({ n, name }) => {
                const id = `preset:${n}`
                return (
                  <button key={n} type="button" role="radio" aria-checked={choice === id} disabled={busy}
                    title={name} onClick={() => void apply(id, () => fetchPreset(n))} className={tile(choice === id)}>
                    <img src={presetUrl(n)} alt={name} loading="lazy" className="w-full h-full" />
                  </button>
                )
              })}
            </div>
          </section>
        ))}
      </div>

      <div>
        <button type="button" disabled={busy} onClick={() => input.current?.click()}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-fc-hover text-fc-text hover:bg-fc-hover transition disabled:opacity-50">
          <Upload size={14} aria-hidden /> {t('appIcon.import')}
        </button>
        <p className="text-xs text-fc-muted mt-1">{t('appIcon.importHint')}</p>
        <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/x-icon,image/vnd.microsoft.icon,.ico,.png,.jpg,.jpeg"
          onChange={e => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void apply('custom', () => importIcon(file))
          }} />
      </div>
    </div>
  )
}
