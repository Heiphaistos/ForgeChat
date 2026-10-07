import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Copy, Download, RotateCcw, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { useT, type Key } from '../../../i18n'
import {
  COLOR_KEYS, contrastReport, fixContrast, isHex, isSafeImageUrl,
  type ColorKey, type CustomTheme, type ThemeSpec,
} from '../../../theme/themeCore'
import { useThemeStore } from '../../../theme/themeStore'
import { Toggle } from '../shared'
import ThemePreview from './ThemePreview'
import { copyThemeCode, downloadTheme, imageFileToDataUrl } from './themeIO'

type BgMode = 'solid' | 'gradient' | 'image'

const COLOR_LABEL: Record<ColorKey, Key> = {
  bg: 'themes.color.bg', sidebar: 'themes.color.sidebar', channel: 'themes.color.channel', chat: 'themes.color.chat',
  input: 'themes.color.input', hover: 'themes.color.hover', border: 'themes.color.border', text: 'themes.color.text',
  muted: 'themes.color.muted', accent: 'themes.color.accent', link: 'themes.color.link', mention: 'themes.color.mention',
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-fc-text">
      <span className="min-w-0 truncate">{label}</span>
      <span className="flex items-center gap-2 shrink-0">{children}</span>
    </label>
  )
}

/** Couleur : nuancier natif + saisie hexadécimale validée (#rrggbb). */
function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <Row label={label}>
      <input type="color" value={value} onChange={e => onChange(e.target.value)} aria-label={label}
        className="w-7 h-7 rounded cursor-pointer border border-fc-hover bg-transparent p-0" />
      <input value={text} maxLength={7} spellCheck={false} aria-label={`${label} (hex)`}
        onChange={e => { setText(e.target.value); if (isHex(e.target.value)) onChange(e.target.value.toLowerCase()) }}
        className={`w-20 px-2 py-1 rounded bg-fc-input text-xs font-mono text-fc-text outline-none ${isHex(text) ? '' : 'ring-1 ring-fc-red'}`} />
    </Row>
  )
}

function Slider({ label, value, min, max, step = 1, format, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; format: (v: number) => string; onChange: (v: number) => void
}) {
  return (
    <Row label={`${label} — ${format(value)}`}>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label}
        onChange={e => onChange(Number(e.target.value))} className="w-40 accent-fc-accent" />
    </Row>
  )
}

const Box = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="space-y-2.5 p-4 rounded-xl border border-fc-hover bg-fc-channel">
    <h4 className="text-xs font-semibold text-fc-muted uppercase tracking-wide">{title}</h4>
    {children}
  </section>
)

/**
 * Éditeur de thème perso : chaque changement s'affiche en direct sur toute l'application
 * (aperçu), « Enregistrer » le garde et l'active, « Annuler » rétablit le thème précédent.
 */
export default function ThemeEditor({ initial, onClose }: { initial: CustomTheme; onClose: () => void }) {
  const t = useT()
  const { setPreview, upsertCustom, select } = useThemeStore()
  const [draft, setDraft] = useState<CustomTheme>(initial)
  const [mode, setMode] = useState<BgMode>(initial.image ? 'image' : initial.gradient ? 'gradient' : 'solid')
  const [url, setUrl] = useState(initial.image && !initial.image.url.startsWith('data:') ? initial.image.url : '')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setPreview(draft) }, [draft, setPreview])
  useEffect(() => () => setPreview(null), [setPreview])

  const patch = (p: Partial<ThemeSpec>) => setDraft(d => ({ ...d, ...p }))
  const setColor = (k: ColorKey, v: string) => setDraft(d => ({ ...d, colors: { ...d.colors, [k]: v } }))
  const stops = draft.gradient?.stops ?? [draft.colors.bg, draft.colors.accent]
  const setStops = (s: string[]) => patch({ gradient: { angle: draft.gradient?.angle ?? 135, stops: s } })
  const translucentBg = mode !== 'solid'

  const changeMode = (m: BgMode) => {
    setMode(m)
    if (m === 'solid') patch({ gradient: null, image: null })
    if (m === 'gradient') patch({ image: null, gradient: draft.gradient ?? { angle: 135, stops }, opacity: draft.opacity < 1 ? draft.opacity : 0.55 })
    if (m === 'image') patch({ opacity: draft.opacity < 1 ? draft.opacity : 0.6 })
  }
  const applyUrl = (u: string) => {
    setUrl(u)
    if (isSafeImageUrl(u) && !u.startsWith('data:')) patch({ image: { url: u, blur: draft.image?.blur ?? 0, dim: draft.image?.dim ?? 0.4 } })
  }
  const pickFile = async (f: File) => {
    const data = await imageFileToDataUrl(f)
    if (!data) { toast.error(t('themes.imageInvalid')); return }
    setUrl('')
    patch({ image: { url: data, blur: draft.image?.blur ?? 0, dim: draft.image?.dim ?? 0.4 } })
  }

  const report = contrastReport(draft)
  const weak = report.text < 4.5 || report.muted < 4.5 || report.link < 4.5
  const save = () => {
    upsertCustom(draft)
    select(draft.id)
    toast.success(t('themes.saved'))
    onClose()
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl overflow-hidden border border-fc-hover">
        <ThemePreview spec={draft} className="h-24" />
      </div>
      <p className="text-xs text-fc-muted">{t('themes.livePreview')}</p>

      <Box title={t('themes.general')}>
        <Row label={t('themes.name')}>
          <input value={draft.name} maxLength={40} onChange={e => patch({ name: e.target.value })}
            className="w-48 px-2 py-1 rounded bg-fc-input text-sm text-fc-text outline-none focus:ring-2 focus:ring-fc-accent" />
        </Row>
        <Row label={t('themes.scheme')}>
          {(['dark', 'light'] as const).map(s => (
            <button key={s} onClick={() => patch({ scheme: s })}
              className={`px-3 py-1 rounded-md text-xs border ${draft.scheme === s ? 'border-fc-accent bg-fc-accent/15 text-fc-text' : 'border-fc-hover text-fc-muted'}`}>
              {t(s === 'dark' ? 'themes.schemeDark' : 'themes.schemeLight')}
            </button>
          ))}
        </Row>
      </Box>

      <Box title={t('themes.colors')}>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5">
          {COLOR_KEYS.map(k => <ColorInput key={k} label={t(COLOR_LABEL[k])} value={draft.colors[k]} onChange={v => setColor(k, v)} />)}
        </div>
      </Box>

      <Box title={t('themes.background')}>
        <div role="radiogroup" className="flex gap-1">
          {(['solid', 'gradient', 'image'] as const).map(m => (
            <button key={m} role="radio" aria-checked={mode === m} onClick={() => changeMode(m)}
              className={`flex-1 px-3 py-1.5 rounded-md text-xs border ${mode === m ? 'border-fc-accent bg-fc-accent/15 text-fc-text' : 'border-fc-hover text-fc-muted'}`}>
              {t(`themes.bg.${m}` as Key)}
            </button>
          ))}
        </div>
        {mode === 'gradient' && <>
          {stops.map((c, i) => (
            <ColorInput key={i} label={t('themes.stop', { n: i + 1 })} value={c} onChange={v => setStops(stops.map((x, j) => (j === i ? v : x)))} />
          ))}
          <div className="flex gap-2">
            {stops.length < 3 && <button className="btn-secondary text-xs" onClick={() => setStops([...stops, draft.colors.accent])}>{t('themes.addStop')}</button>}
            {stops.length > 2 && <button className="btn-secondary text-xs" onClick={() => setStops(stops.slice(0, 2))}>{t('themes.removeStop')}</button>}
          </div>
          <Slider label={t('themes.angle')} value={draft.gradient?.angle ?? 135} min={0} max={360} format={v => `${v}°`}
            onChange={v => patch({ gradient: { stops, angle: v } })} />
        </>}
        {mode === 'image' && <>
          <Row label={t('themes.imageUrl')}>
            <input value={url} onChange={e => applyUrl(e.target.value.trim())} placeholder="https://…" spellCheck={false}
              className={`w-56 px-2 py-1 rounded bg-fc-input text-xs text-fc-text outline-none ${!url || isSafeImageUrl(url) ? '' : 'ring-1 ring-fc-red'}`} />
          </Row>
          <div className="flex items-center gap-2">
            <button className="btn-secondary text-xs" onClick={() => fileRef.current?.click()}>{t('themes.imageFile')}</button>
            {draft.image && <button className="btn-secondary text-xs" onClick={() => { setUrl(''); patch({ image: null }) }}>{t('themes.imageRemove')}</button>}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pickFile(f) }} />
          </div>
          <p className="text-xs text-fc-muted">{t('themes.imageHint')}</p>
          {draft.image && <>
            <Slider label={t('themes.imageBlur')} value={draft.image.blur} min={0} max={30} format={v => `${v}px`}
              onChange={v => draft.image && patch({ image: { ...draft.image, blur: v } })} />
            <Slider label={t('themes.imageDim')} value={Math.round(draft.image.dim * 100)} min={0} max={90} format={v => `${v} %`}
              onChange={v => draft.image && patch({ image: { ...draft.image, dim: v / 100 } })} />
          </>}
        </>}
      </Box>

      <Box title={t('themes.surfaces')}>
        {translucentBg && <Slider label={t('themes.opacity')} value={Math.round(draft.opacity * 100)} min={15} max={100}
          format={v => `${v} %`} onChange={v => patch({ opacity: v / 100 })} />}
        {translucentBg && <Slider label={t('themes.glass')} value={draft.blur} min={0} max={40} format={v => `${v}px`} onChange={v => patch({ blur: v })} />}
        <Slider label={t('themes.radius')} value={draft.radius} min={0} max={2} step={0.25} format={v => `×${v}`} onChange={v => patch({ radius: v })} />
        <Row label={t('themes.outline')}><Toggle value={draft.outline} onChange={v => patch({ outline: v })} /></Row>
      </Box>

      <div className={`flex items-start gap-2 p-3 rounded-lg text-xs border ${weak ? 'border-fc-yellow/50 text-fc-yellow' : 'border-fc-green/40 text-fc-green'}`}>
        {weak ? <AlertTriangle size={14} className="shrink-0 mt-0.5" /> : <ShieldCheck size={14} className="shrink-0 mt-0.5" />}
        <div className="flex-1">
          {t(weak ? 'themes.contrastWeak' : 'themes.contrastOk', {
            text: report.text.toFixed(1), muted: report.muted.toFixed(1), link: report.link.toFixed(1),
          })}
        </div>
        {weak && <button className="underline shrink-0" onClick={() => setDraft(d => ({ ...fixContrast(d), id: d.id }))}>{t('themes.fixContrast')}</button>}
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={save} className="btn-primary">{t('themes.save')}</button>
        <button onClick={onClose} className="btn-secondary">{t('common.cancel')}</button>
        <button onClick={() => { setDraft(initial); setMode(initial.image ? 'image' : initial.gradient ? 'gradient' : 'solid') }}
          className="btn-secondary flex items-center gap-1"><RotateCcw size={13} /> {t('themes.reset')}</button>
        <span className="flex-1" />
        <button onClick={async () => { if (await copyThemeCode(draft)) toast.success(t('themes.codeCopied')); else toast.error(t('themes.copyFailed')) }}
          className="btn-secondary flex items-center gap-1"><Copy size={13} /> {t('themes.copyCode')}</button>
        <button onClick={() => downloadTheme(draft)} className="btn-secondary flex items-center gap-1"><Download size={13} /> {t('themes.download')}</button>
      </div>
    </div>
  )
}
