import { useMemo, type CSSProperties, type ReactNode } from 'react'

/**
 * Personnalisation du profil (gratuite) : décoration d'avatar, thème de la fiche
 * et effet à l'ouverture. Identifiants identiques à la liste blanche du serveur
 * (server/src/models/user.rs) et au mobile (mobile/src/features/account/profileDecor.ts).
 */

type Deco = { id: string; label: string; colors: string[]; kind: 'ring' | 'dashed' | 'double'; anim?: 'spin' | 'pulse' }

export const DECORATIONS: Deco[] = [
  { id: 'gold', label: 'Or', colors: ['#f7d774', '#b8860b', '#fff1b8', '#b8860b'], kind: 'ring' },
  { id: 'silver', label: 'Argent', colors: ['#f4f6f8', '#8e9aa6', '#ffffff', '#8e9aa6'], kind: 'ring' },
  { id: 'neon', label: 'Néon', colors: ['#00f0ff', '#ff00e5'], kind: 'ring', anim: 'spin' },
  { id: 'rainbow', label: 'Arc-en-ciel', colors: ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#af52de'], kind: 'ring', anim: 'spin' },
  { id: 'fire', label: 'Feu', colors: ['#ff3d00', '#ffb300', '#ff6d00'], kind: 'ring', anim: 'pulse' },
  { id: 'ice', label: 'Glace', colors: ['#a8e6ff', '#ffffff', '#5ac8fa'], kind: 'ring' },
  { id: 'emerald', label: 'Émeraude', colors: ['#2ecc71', '#0b6623', '#7dffb0'], kind: 'ring' },
  { id: 'sakura', label: 'Sakura', colors: ['#ffb7c5', '#ff6f91'], kind: 'ring', anim: 'pulse' },
  { id: 'void', label: 'Néant', colors: ['#6a00ff', '#120024', '#b388ff'], kind: 'ring', anim: 'spin' },
  { id: 'sunset', label: 'Coucher de soleil', colors: ['#ff7e5f', '#feb47b', '#c471ed'], kind: 'ring' },
  { id: 'ocean', label: 'Océan', colors: ['#00c6ff', '#0072ff'], kind: 'ring', anim: 'spin' },
  { id: 'dashed', label: 'Pointillés', colors: ['#5ee7df'], kind: 'dashed', anim: 'spin' },
  { id: 'double', label: 'Double anneau', colors: ['#b388ff'], kind: 'double' },
  { id: 'glow', label: 'Halo', colors: ['#ffffff'], kind: 'ring', anim: 'pulse' },
]

export const PROFILE_EFFECTS: { id: string; label: string; char: string; color: string; motion: 'fall' | 'rise' | 'twinkle' }[] = [
  { id: 'sparkles', label: 'Étincelles', char: '✦', color: '#ffe680', motion: 'twinkle' },
  { id: 'snow', label: 'Neige', char: '❄', color: '#e6f4ff', motion: 'fall' },
  { id: 'hearts', label: 'Cœurs', char: '♥', color: '#ff5c8a', motion: 'rise' },
  { id: 'stars', label: 'Étoiles', char: '★', color: '#ffd166', motion: 'fall' },
  { id: 'bubbles', label: 'Bulles', char: '○', color: '#9be7ff', motion: 'rise' },
]

/** Entier 0xRRGGBB → « #rrggbb ». */
export const hexColor = (c: number) => `#${c.toString(16).padStart(6, '0')}`

/** Fond de la fiche selon le thème ; undefined = fond par défaut. */
export function profileThemeBackground(primary?: number | null, accent?: number | null): string | undefined {
  if (primary == null && accent == null) return undefined
  const a = hexColor(primary ?? accent!)
  const b = hexColor(accent ?? primary!)
  // Voile sombre par-dessus pour garder le texte lisible quelles que soient les couleurs.
  return `linear-gradient(rgba(0,0,0,.45), rgba(0,0,0,.45)), linear-gradient(160deg, ${a} 0%, ${b} 100%)`
}

/** Anneau décoratif autour d'un avatar de `size` px (rien si décoration inconnue). */
export function AvatarDecoration({ id, size, children }: { id?: string | null; size: number; children: ReactNode }) {
  const deco = DECORATIONS.find(d => d.id === id)
  if (!deco) return <>{children}</>
  const w = Math.max(2, Math.round(size * 0.07))
  const off = -(w + 1)
  const anim = deco.anim ? `fc-deco-${deco.anim}` : ''
  const c = deco.colors
  const style: CSSProperties = { inset: off }
  if (deco.kind === 'ring') {
    style.padding = w
    style.background = `conic-gradient(${[...c, c[0]].join(', ')})`
    if (deco.id === 'glow' || deco.id === 'fire' || deco.id === 'neon') style.filter = `drop-shadow(0 0 ${w}px ${c[0]})`
  } else {
    style.border = `${deco.kind === 'double' ? w + 2 : w}px ${deco.kind === 'double' ? 'double' : 'dashed'} ${c[0]}`
  }
  return (
    <span className="relative inline-flex flex-shrink-0">
      {children}
      <span aria-hidden className={`fc-deco ${deco.kind === 'ring' ? 'fc-deco-ring' : ''} ${anim}`} style={style} />
    </span>
  )
}

/** Particules jouées une fois au montage ; masquées si « réduire les animations ». */
export function ProfileEffect({ id }: { id?: string | null }) {
  const fx = PROFILE_EFFECTS.find(e => e.id === id)
  // Positions tirées une fois par montage (rejouer = remonter avec une autre `key`).
  const parts = useMemo(() => Array.from({ length: 14 }, (_, i) => ({
    left: Math.random() * 95,
    top: fx?.motion === 'twinkle' ? Math.random() * 90 : fx?.motion === 'rise' ? 85 + Math.random() * 10 : -5,
    delay: (i * 0.18 + Math.random() * 0.3).toFixed(2),
    dur: (2.2 + Math.random() * 1.2).toFixed(2),
    size: 10 + Math.round(Math.random() * 10),
  })), [fx?.motion])
  if (!fx) return null
  return (
    <div className="fc-fx" aria-hidden>
      {parts.map((p, i) => (
        <span
          key={i}
          style={{
            left: `${p.left}%`, top: `${p.top}%`, fontSize: p.size, color: fx.color,
            animationName: `fc-fx-${fx.motion}`, animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s`,
          }}
        >{fx.char}</span>
      ))}
    </div>
  )
}
