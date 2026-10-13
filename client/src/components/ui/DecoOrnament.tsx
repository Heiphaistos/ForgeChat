import { memo, type ReactNode } from 'react'
import type { Ornament } from '../../lib/profileDecor'

/**
 * Accessoire d'une décoration d'avatar (couronne, auréole, ailes, oreilles, casque…) dessiné en
 * SVG en ligne. Repère : l'avatar occupe le carré 0-100 ; l'accessoire déborde autour. Les
 * couleurs sont celles du catalogue (lib/profileDecor.ts), éventuellement mélangées à la teinte
 * choisie (un « #rrggbb » calculé), jamais une chaîne reçue. Animations : profileStyles.css (fc-orn-*).
 */

/** Feuilles de laurier le long du bas de l'avatar (calculées une fois). */
const LAUREL = (() => {
  const out: { x: number; y: number; r: number }[] = []
  for (let i = 0; i < 7; i++) {
    const a = ((105 + i * 14) * Math.PI) / 180
    out.push({ x: 50 + 56 * Math.cos(a), y: 50 + 56 * Math.sin(a), r: 105 + i * 14 + 90 })
  }
  return out
})()

/** Moitié gauche + son miroir (accessoires symétriques). */
function Pair({ children, cls }: { children: ReactNode; cls?: string }) {
  return (
    <>
      <g className={cls}>{children}</g>
      <g transform="translate(100 0) scale(-1 1)"><g className={cls ? `${cls} fc-orn-late` : undefined}>{children}</g></g>
    </>
  )
}

function shapes(kind: Ornament, c: string[]): ReactNode {
  const [a, b, d] = [c[0], c[1] ?? c[0], c[2] ?? c[0]]
  switch (kind) {
    case 'crown':
      return (
        <g className="fc-orn-float">
          <polygon points="26,16 21,-12 36,0 50,-20 64,0 79,-12 74,16" fill={a} stroke={b} strokeWidth="2" strokeLinejoin="round" />
          <rect x="26" y="10" width="48" height="6" rx="2" fill={b} />
          <circle cx="50" cy="-6" r="3.5" fill={d} className="fc-orn-shine" />
          <circle cx="36" cy="4" r="2.5" fill={d} className="fc-orn-shine fc-orn-late" />
          <circle cx="64" cy="4" r="2.5" fill={d} className="fc-orn-shine" />
        </g>
      )
    case 'tiara':
      return (
        <g className="fc-orn-float">
          <path d="M22 18 Q50 -2 78 18" fill="none" stroke={a} strokeWidth="4" strokeLinecap="round" />
          <polygon points="44,8 50,-12 56,8" fill={b} stroke={a} strokeWidth="1.5" />
          <polygon points="31,13 34,0 39,11" fill={b} />
          <polygon points="61,11 66,0 69,13" fill={b} />
          <circle cx="50" cy="0" r="3" fill={d} className="fc-orn-shine" />
        </g>
      )
    case 'halo':
      return <ellipse className="fc-orn-float" cx="50" cy="-10" rx="30" ry="8" fill="none" stroke={a} strokeWidth="5" />
    case 'horns':
      return (
        <Pair cls="fc-orn-sway">
          <path d="M26 20 C14 8 12 -8 20 -20 C22 -6 30 6 38 12 Z" fill={b} stroke={a} strokeWidth="1.5" strokeLinejoin="round" />
        </Pair>
      )
    case 'catears':
      return (
        <Pair cls="fc-orn-twitch">
          <polygon points="12,32 14,-6 44,10" fill={a} strokeLinejoin="round" />
          <polygon points="19,24 20,5 35,13" fill={b} />
        </Pair>
      )
    case 'foxears':
      return (
        <Pair cls="fc-orn-twitch">
          <polygon points="10,34 8,-16 44,10" fill={a} />
          <polygon points="17,25 15,-3 33,12" fill={b} />
          <polygon points="8,-16 11,-4 15,-8" fill="#ffffff" />
        </Pair>
      )
    case 'bunnyears':
      return (
        <Pair cls="fc-orn-twitch">
          <ellipse cx="32" cy="-16" rx="10" ry="28" transform="rotate(-14 32 -16)" fill={a} />
          <ellipse cx="32" cy="-14" rx="5" ry="20" transform="rotate(-14 32 -14)" fill={b} />
        </Pair>
      )
    case 'headphones':
      return (
        <g className="fc-orn-beat">
          <path d="M8 52 A42 42 0 0 1 92 52" fill="none" stroke={a} strokeWidth="6" strokeLinecap="round" />
          <Pair>
            <rect x="-4" y="38" width="16" height="30" rx="7" fill={a} stroke={b} strokeWidth="2" />
            <rect x="1" y="44" width="5" height="18" rx="2.5" fill={b} className="fc-orn-shine" />
          </Pair>
        </g>
      )
    case 'wings':
      return (
        <Pair cls="fc-orn-flap">
          <path d="M4 46 C-24 22 -48 30 -52 50 C-42 48 -36 52 -32 58 C-26 56 -18 60 -16 66 C-10 62 -4 62 4 66 Z" fill={a} stroke={b} strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M-6 50 C-20 42 -32 42 -40 48" fill="none" stroke={b} strokeWidth="1.2" />
        </Pair>
      )
    case 'fairywings':
      return (
        <Pair cls="fc-orn-flap">
          <ellipse cx="-8" cy="32" rx="22" ry="13" transform="rotate(-30 -8 32)" fill={a} fillOpacity=".6" stroke={b} strokeWidth="1.2" />
          <ellipse cx="-4" cy="62" rx="14" ry="9" transform="rotate(25 -4 62)" fill={b} fillOpacity=".55" stroke={a} strokeWidth="1.2" />
        </Pair>
      )
    case 'batwings':
      return (
        <Pair cls="fc-orn-flap">
          <path d="M4 44 L-20 24 L-48 34 L-42 46 Q-36 40 -30 50 Q-24 44 -18 56 Q-10 50 -4 60 Z" fill={a} stroke={b} strokeWidth="1.5" strokeLinejoin="round" />
        </Pair>
      )
    case 'antlers':
      return (
        <Pair cls="fc-orn-sway">
          <path d="M34 12 L26 -8 L16 -24 M26 -8 L10 -8 M21 -16 L28 -28" fill="none" stroke={a} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
        </Pair>
      )
    case 'bow':
      return (
        <g className="fc-orn-sway" transform="rotate(20 78 8)">
          <polygon points="78,8 58,-4 60,20" fill={a} stroke={b} strokeWidth="1.5" strokeLinejoin="round" />
          <polygon points="78,8 98,-4 96,20" fill={a} stroke={b} strokeWidth="1.5" strokeLinejoin="round" />
          <circle cx="78" cy="8" r="5" fill={b} />
        </g>
      )
    case 'partyhat':
      return (
        <g className="fc-orn-float" transform="rotate(12 52 0)">
          <polygon points="36,8 52,-38 68,8" fill={a} />
          <path d="M41 -6 L63 -6 M45 -18 L59 -18 M48 -28 L56 -28" stroke={b} strokeWidth="3" />
          <circle cx="52" cy="-38" r="5" fill={d} className="fc-orn-shine" />
        </g>
      )
    case 'witchhat':
      return (
        <g className="fc-orn-sway">
          <ellipse cx="50" cy="8" rx="36" ry="7" fill={a} />
          <path d="M32 6 L56 -42 L70 6 Z" fill={a} />
          <rect x="34" y="-4" width="34" height="6" fill={b} />
        </g>
      )
    case 'santahat':
      return (
        <g className="fc-orn-sway">
          <path d="M22 12 Q38 -32 76 -20 L80 -8 Q58 -16 78 12 Z" fill={a} />
          <rect x="18" y="6" width="64" height="10" rx="5" fill={b} />
          <circle cx="80" cy="-16" r="6" fill={b} />
        </g>
      )
    case 'laurel':
      return (
        <Pair cls="fc-orn-sway">
          {LAUREL.map((l, i) => (
            <ellipse key={i} cx={l.x.toFixed(1)} cy={l.y.toFixed(1)} rx="7" ry="3" transform={`rotate(${l.r} ${l.x.toFixed(1)} ${l.y.toFixed(1)})`} fill={i % 2 ? b : a} />
          ))}
        </Pair>
      )
  }
}

/** Accessoire autour d'un avatar de `size` px (à placer dans le conteneur de la décoration). */
export const DecoOrnament = memo(function DecoOrnament({ kind, colors, size }: { kind: Ornament; colors: string[]; size: number }) {
  return (
    <svg
      aria-hidden
      className={`fc-orn fc-orn-${kind}`}
      viewBox="-50 -50 200 200"
      width={size * 2}
      height={size * 2}
      style={{ left: -size / 2, top: -size / 2 }}
    >
      {shapes(kind, colors)}
    </svg>
  )
})
