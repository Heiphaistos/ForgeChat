import { useMemo, type CSSProperties, type ReactNode } from 'react'
import {
  DECORATIONS, PROFILE_EFFECTS, cleanDecoOpts, decoGlow, decoVars, fxCount, glyphs, tintColor,
  type Deco, type DecoOpts, type ProfileFx,
} from '../../lib/profileDecor'
import { DecoOrnament } from './DecoOrnament'

/**
 * Personnalisation du profil (gratuite) : décoration d'avatar et effet à l'ouverture de la fiche.
 * Catalogue, réglages et bornes : lib/profileDecor.ts (mêmes identifiants que le serveur et le
 * mobile). Tout est dessiné en CSS et SVG en ligne : aucune image ni requête réseau. Les réglages
 * de l'utilisateur ne passent dans le style que sous forme de nombres bornés (variables CSS).
 */
export {
  DECORATIONS, DECO_GROUPS, FX_GROUPS, PROFILE_EFFECTS, hexColor, profileThemeBackground,
  type Deco, type ProfileFx,
} from '../../lib/profileDecor'

const DECO_BY_ID = new Map(DECORATIONS.map(d => [d.id, d]))
const FX_BY_ID = new Map(PROFILE_EFFECTS.map(f => [f.id, f]))

/** Fond de l'anneau selon sa forme. */
function ringBackground(kind: Deco['kind'], c: string[]): string {
  if (kind === 'stripes') {
    const step = 360 / 24
    return `repeating-conic-gradient(${c.map((col, i) => `${col} ${i * step}deg ${(i + 1) * step}deg`).join(', ')} ${c.length * step}deg)`
  }
  if (kind === 'segments' || kind === 'pixelframe') {
    // 12 segments séparés par un petit vide, couleurs en boucle.
    const seg = 30
    const stops: string[] = []
    for (let i = 0; i < 12; i++) {
      const col = c[i % c.length]
      stops.push(`${col} ${i * seg}deg ${i * seg + seg - 6}deg`, `transparent ${i * seg + seg - 6}deg ${(i + 1) * seg}deg`)
    }
    return `conic-gradient(${stops.join(', ')})`
  }
  return `conic-gradient(${[...c, c[0]].join(', ')})`
}

/** Arcs électriques : trois zigzags autour du cercle (repère -60…60), calculés une fois. */
const ARC_PATHS = [0, 120, 240].map(start => {
  const pts: string[] = []
  for (let t = 0; t <= 6; t++) {
    const a = ((start + t * 11) * Math.PI) / 180
    const r = t % 2 ? 57 : 49
    pts.push(`${(r * Math.cos(a)).toFixed(1)} ${(r * Math.sin(a)).toFixed(1)}`)
  }
  return `M${pts.join(' L')}`
})

/** Position (px, coin haut gauche) d'un élément de `s` px à l'angle `deg` sur un cercle de rayon `r`. */
const onCircle = (size: number, r: number, deg: number, s: number) => ({
  left: size / 2 + r * Math.cos((deg * Math.PI) / 180) - s / 2,
  top: size / 2 + r * Math.sin((deg * Math.PI) / 180) - s / 2,
})

/** Bras tournants (orbite, couronne de glyphes) : un glyphe en haut de chaque bras. */
function Arms({ chars, className, inset, fontSize, color }: { chars: string[]; className: string; inset: number; fontSize: number; color: (i: number) => string }) {
  return (
    <span aria-hidden className={`fc-deco-spinner ${className}`} style={{ inset }}>
      {chars.map((ch, i) => (
        <span key={i} className="fc-deco-arm" style={{ transform: `rotate(${(360 / chars.length) * i}deg)` }}>
          <span className="fc-deco-sat" style={{ fontSize, color: color(i) }}>{ch}</span>
        </span>
      ))}
    </span>
  )
}

/**
 * Décoration autour d'un avatar de `size` px (rien si décoration inconnue). `opts` : réglages
 * reçus du serveur (users.avatar_decoration_opts), relus par cleanDecoOpts.
 */
export function AvatarDecoration({ id, size, opts, children }: { id?: string | null; size: number; opts?: unknown; children: ReactNode }) {
  const deco = id ? DECO_BY_ID.get(id) : undefined
  if (!deco) return <>{children}</>
  return <DecoLayers deco={deco} size={size} o={cleanDecoOpts(opts)}>{children}</DecoLayers>
}

function DecoLayers({ deco, size, o, children }: { deco: Deco; size: number; o: DecoOpts; children: ReactNode }) {
  const k = o.scale / 100
  const w = Math.max(2, Math.round(size * 0.07 * (deco.thick ?? 1) * k))
  // Taille : la décoration s'écarte (ou se resserre) autour de l'avatar, qui ne bouge pas.
  const grow = Math.round((size * (k - 1)) / 2)
  const off = -(w + 1 + grow)
  const colors = deco.colors.map(c => tintColor(c, o.tint))
  const tint = (c: string) => tintColor(c, o.tint)
  const accent = deco.glow ? tint(deco.glow) : colors[colors.length - 1]
  const anim = deco.anim ? `fc-deco-${deco.anim}` : ''
  const radius = deco.kind === 'frame' ? '24%' : deco.kind === 'pixelframe' ? '0' : undefined
  const ring: CSSProperties = { borderRadius: radius }
  const box: CSSProperties = { inset: off, borderRadius: radius }
  const borderKind = deco.kind === 'dashed' || deco.kind === 'double' || deco.kind === 'frame'
  if (borderKind) {
    const style = deco.kind === 'double' ? 'double' : deco.kind === 'frame' ? 'solid' : 'dashed'
    ring.border = `${deco.kind === 'double' ? w + 2 : w}px ${style} ${colors[0]}`
    // Plusieurs couleurs : une par côté.
    if (colors.length > 1) ring.borderColor = [0, 1, 2, 3].map(i => colors[i % colors.length]).join(' ')
  } else {
    ring.padding = w
    ring.background = ringBackground(deco.kind, colors)
  }
  const big = size >= 28
  const glyphSize = Math.max(7, Math.round(size * 0.2 * k))
  const r = size / 2 + w * 0.6 + grow
  const glow = decoGlow(deco, w, o)
  // Filtre posé seulement s'il sert (halo, teinte, luminosité ou saturation) : plus léger en liste.
  const filtered = glow.radius > 0 || o.hue !== 0 || o.brightness !== 100 || o.saturation !== 100
  const rootClass = `fc-deco-root${filtered ? ' fc-deco-fx' : ''}${o.animate ? '' : ' fc-deco-still'}${o.pulse ? ' fc-deco-throb' : ''}`
  const rain = big && deco.rain ? glyphs(deco.rain.chars).slice(0, 6) : []
  return (
    <span className="relative inline-flex flex-shrink-0">
      {children}
      <span aria-hidden className={rootClass} style={decoVars(o, glow) as CSSProperties}>
        {big && deco.aura && (
          <span
            className="fc-deco-aura"
            style={{ inset: off - Math.round(w * 1.8), background: `radial-gradient(closest-side, transparent 66%, ${tint(deco.aura)} 80%, transparent 100%)`, borderRadius: radius }}
          />
        )}
        {big && deco.ripple && [0, 1].map(i => (
          <span key={i} className="fc-deco-ripple" style={{ inset: off, borderColor: tint(deco.ripple!), borderRadius: radius, animationDelay: `${-i * 1.3}s` }} />
        ))}
        <span className="fc-deco" style={box}>
          <span className={`fc-deco-layer ${borderKind ? '' : 'fc-deco-ring'} ${anim}`} style={ring} />
          {deco.kind === 'dual' && <span className="fc-deco-layer fc-deco-dual" style={{ inset: -Math.max(2, Math.round(w * 0.6)), borderColor: colors[colors.length - 1] }} />}
        </span>
        {big && deco.flames && (
          <span className="fc-deco-spinner fc-deco-flames" style={{ inset: off }}>
            {Array.from({ length: 10 }, (_, i) => (
              <span key={i} className="fc-deco-arm" style={{ transform: `rotate(${i * 36}deg)` }}>
                <span
                  className="fc-deco-flame"
                  style={{
                    width: Math.max(4, w * 1.5), height: Math.max(7, w * 2.6), marginLeft: -Math.max(4, w * 1.5) / 2,
                    background: `radial-gradient(ellipse at 50% 90%, ${colors[2 % colors.length]} 0%, ${colors[1 % colors.length]} 40%, ${colors[0]} 68%, transparent 72%)`,
                    animationDelay: `${-(i % 5) * 0.17}s`,
                  }}
                />
              </span>
            ))}
          </span>
        )}
        {big && deco.arcs && (
          <span className="fc-deco-spinner fc-deco-arcs" style={{ inset: off - w }}>
            <svg viewBox="-60 -60 120 120" aria-hidden>
              {ARC_PATHS.map((d, i) => (
                <path key={i} d={d} className="fc-deco-arc" stroke={tint(deco.arcs!)} style={{ animationDelay: `${-i * 0.45}s` }} />
              ))}
            </svg>
          </span>
        )}
        {deco.glyph && big && [45, 135, 225, 315].map((a, i) => (
          <span
            key={a}
            className="fc-deco-glyph"
            style={{
              ...onCircle(size, r, a, glyphSize),
              width: glyphSize, height: glyphSize, fontSize: glyphSize,
              color: deco.glow ? accent : colors[i % colors.length],
              animationDelay: `${i * 0.45}s`,
            }}
          >{deco.glyph}</span>
        ))}
        {big && deco.wreath && (
          <Arms chars={glyphs(deco.wreath)} className="fc-deco-wreath" inset={off - Math.round(glyphSize * 0.15)} fontSize={Math.max(6, Math.round(glyphSize * 0.62))} color={i => colors[i % colors.length] === 'transparent' ? accent : (deco.glow ? accent : colors[i % colors.length])} />
        )}
        {deco.orbit && (
          <Arms
            chars={Array.from({ length: deco.orbitN ?? 1 }, () => deco.orbit!)}
            className="fc-deco-orbit"
            inset={off}
            fontSize={Math.max(6, Math.round(size * 0.14 * k))}
            color={() => accent}
          />
        )}
        {rain.map((ch, i) => (
          <span
            key={i}
            className={`fc-deco-p fc-deco-p-${deco.rain!.motion}`}
            style={{
              ...onCircle(size, r + w * 0.4, (360 / rain.length) * i + 25, glyphSize),
              width: glyphSize, height: glyphSize, fontSize: Math.round(glyphSize * 0.75),
              color: deco.glow ? accent : colors[i % colors.length],
              animationDelay: `${-i * 0.55}s`,
            }}
          >{ch}</span>
        ))}
        {big && deco.ornament && <DecoOrnament kind={deco.ornament} colors={colors.filter(c => c !== 'transparent')} size={size} />}
      </span>
    </span>
  )
}

/** Particules (et calque éventuel) jouées une fois au montage ; masquées si « réduire les animations ».
 *  `intensity` (25-200 %) multiplie le nombre de particules. */
export function ProfileEffect({ id, intensity }: { id?: string | null; intensity?: number | null }) {
  const fx = id ? FX_BY_ID.get(id) : undefined
  const n = fx ? fxCount(fx, intensity ?? 100) : 0
  // Positions tirées une fois par montage (rejouer = remonter avec une autre `key`).
  const parts = useMemo(() => (fx ? makeParts(fx, n) : []), [fx, n])
  if (!fx) return null
  return (
    <div className="fc-fx" aria-hidden>
      {fx.overlay && <div className={`fc-fx-ov fc-fx-ov-${fx.overlay}`} />}
      {parts.map((p, i) => (
        <span
          key={i}
          className={fx.shape ? `fc-fx-shape fc-fx-shape-${fx.shape}` : undefined}
          style={{
            left: `${p.left}%`, top: `${p.top}%`, fontSize: p.size, color: p.color,
            animationName: `fc-fx-${fx.motion}`, animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s`,
            ['--fx-dx' as string]: `${p.dx}px`, ['--fx-dy' as string]: `${p.dy}px`, ['--fx-rot' as string]: `${p.rot}deg`,
          }}
        >{fx.shape ? null : p.char}</span>
      ))}
    </div>
  )
}

function makeParts(fx: ProfileFx, n: number) {
  const m = fx.motion
  const base = fx.size ?? 10
  return Array.from({ length: n }, (_, i) => {
    const angle = Math.random() * Math.PI * 2
    const dist = 60 + Math.random() * 110
    const left = m === 'burst' || m === 'swirl' ? 50
      : m === 'diagonal' ? 20 + Math.random() * 90
      : m === 'flap' ? Math.random() * 60
      : m === 'float' ? -10 + Math.random() * 30
      : Math.random() * 95
    const top = m === 'twinkle' || m === 'drift' ? Math.random() * 90
      : m === 'rise' || m === 'smoke' ? 85 + Math.random() * 10
      : m === 'burst' ? 35
      : m === 'swirl' ? 45
      : m === 'flap' ? 60 + Math.random() * 35
      : m === 'float' ? 10 + Math.random() * 75
      : -5 - Math.random() * 10
    const delay = m === 'rain' ? i * 0.06 + Math.random() * 0.4
      : m === 'burst' ? Math.floor(i / 9) * 0.6 + Math.random() * 0.15
      : m === 'swirl' ? Math.random() * 1.2
      : i * Math.min(0.18, 3 / Math.max(1, n)) + Math.random() * 0.3
    const dur = m === 'rain' ? 0.7 + Math.random() * 0.5
      : m === 'burst' ? 1.3 + Math.random() * 0.5
      : m === 'float' || m === 'smoke' ? 3.2 + Math.random() * 1.2
      : 2.2 + Math.random() * 1.2
    return {
      left, top,
      delay: delay.toFixed(2),
      dur: dur.toFixed(2),
      size: base + Math.round(Math.random() * (m === 'rain' ? 6 : 10)),
      char: fx.chars[Math.floor(Math.random() * fx.chars.length)],
      color: fx.colors[Math.floor(Math.random() * fx.colors.length)],
      // Déplacements (px) calculés ici : burst (direction), sway/drift (écart latéral),
      // swirl (rayon de départ), float/flap (traversée).
      dx: Math.round(m === 'burst' ? Math.cos(angle) * dist : m === 'swirl' ? 40 + Math.random() * 120 : m === 'float' || m === 'flap' ? 80 + Math.random() * 60 : (Math.random() - 0.5) * 80),
      dy: Math.round(m === 'burst' ? Math.sin(angle) * dist : m === 'flap' ? -(60 + Math.random() * 80) : (Math.random() - 0.5) * 60),
      rot: Math.round(Math.random() * 360),
    }
  })
}
