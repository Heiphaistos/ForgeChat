// Choix de l'icône d'application (Apparence) : icône d'origine, 50 prédéfinies, ou import.
import { useEffect, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import toast from 'react-hot-toast'
import { useT } from '../../../i18n'
import { errText } from '../../../lib/desktop'
import { IconError, PRESET_COUNT, currentIcon, fetchPreset, importIcon, presetUrl, setAppIcon } from '../../../lib/appIcon'

const PRESETS = Array.from({ length: PRESET_COUNT }, (_, i) => i + 1)
const tile = (on: boolean) =>
  `w-11 h-11 rounded-lg p-0.5 border-2 transition ${on ? 'border-fc-accent' : 'border-transparent hover:border-fc-hover'}`

export default function AppIconPicker() {
  const t = useT()
  const [choice, setChoice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { void currentIcon().then(setChoice).catch(() => {}) }, [])

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

  return (
    <div className="space-y-3">
      <p className="text-xs text-fc-muted">{t('appIcon.hint')}</p>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('appIcon.title')}>
        <button type="button" role="radio" aria-checked={choice === null} disabled={busy} title={t('appIcon.default')}
          onClick={() => void apply(null)} className={tile(choice === null)}>
          <img src="/icons/icon-192.png" alt={t('appIcon.default')} className="w-full h-full rounded-md" />
        </button>
        {PRESETS.map(n => {
          const id = `preset:${n}`
          return (
            <button key={n} type="button" role="radio" aria-checked={choice === id} disabled={busy}
              title={t('appIcon.preset', { n })} onClick={() => void apply(id, () => fetchPreset(n))} className={tile(choice === id)}>
              <img src={presetUrl(n)} alt={t('appIcon.preset', { n })} loading="lazy" className="w-full h-full" />
            </button>
          )
        })}
        {choice === 'custom' && (
          <span role="radio" aria-checked title={t('appIcon.custom')} className={`${tile(true)} flex items-center justify-center text-[10px] text-fc-text`}>
            {t('appIcon.custom')}
          </span>
        )}
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
