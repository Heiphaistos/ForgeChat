import { cssGradient, isTranslucent, rgbOf, type ThemeSpec } from '../../../theme/themeCore'

const rgba = (hex: string, a: number) => `rgb(${rgbOf(hex).join(' ')} / ${a})`

/** Miniature d'application dessinée avec les couleurs du thème (valeurs validées uniquement). */
export default function ThemePreview({ spec, className = 'h-14' }: { spec: ThemeSpec; className?: string }) {
  const c = spec.colors
  const a = isTranslucent(spec) ? spec.opacity : 1
  const layers = [
    ...(spec.image ? [`url("${spec.image.url}") center / cover`] : []),
    ...(spec.gradient ? [cssGradient(spec.gradient)] : []),
    c.bg,
  ]
  const line = spec.outline ? `1px solid ${c.border}` : 'none'
  const radius = `${4 * spec.radius}px`
  return (
    <div aria-hidden="true" className={`flex overflow-hidden ${className}`} style={{ background: layers.join(', ') }}>
      <div className="w-[16%] flex flex-col items-center gap-1 pt-1.5" style={{ background: rgba(c.sidebar, a), borderRight: line }}>
        <span className="w-3 h-3 rounded-full" style={{ background: c.accent }} />
        <span className="w-3 h-3 rounded-full" style={{ background: c.hover }} />
      </div>
      <div className="w-[28%] p-1.5 space-y-1" style={{ background: rgba(c.channel, a), borderRight: line }}>
        <div className="h-1.5 w-4/5" style={{ background: c.muted, borderRadius: radius }} />
        <div className="h-1.5 w-3/5" style={{ background: c.text, borderRadius: radius }} />
        <div className="h-1.5 w-2/3" style={{ background: c.muted, borderRadius: radius }} />
      </div>
      <div className="flex-1 p-1.5 flex flex-col gap-1" style={{ background: rgba(c.bg, a) }}>
        <div className="h-1.5 w-1/2" style={{ background: c.text, borderRadius: radius }} />
        <div className="h-1.5 w-4/5" style={{ background: c.muted, borderRadius: radius }} />
        <div className="h-1.5 w-1/3" style={{ background: c.link, borderRadius: radius }} />
        <div className="mt-auto h-2.5" style={{ background: rgba(c.input, a), border: line, borderRadius: radius }} />
      </div>
    </div>
  )
}
