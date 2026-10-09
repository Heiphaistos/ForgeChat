// Briques communes aux thèmes de navigation de la page Actualités : données, icônes, pastilles, tri.
import { useState, type DragEvent, type ReactNode } from 'react'
import {
  Atom, BookOpen, ChefHat, ChevronDown, ChevronUp, Clapperboard, Cpu, Film, Folder, Gamepad2, Globe, Monitor,
  Music, Newspaper, Shield, Smile, Sparkles, Tag, Trophy, Tv, Youtube, type LucideIcon,
} from 'lucide-react'
import type { useT } from '../../i18n'
import { key, short, type GroupId } from '../newsOrder'
import type { NewsPrefs } from './useNewsPrefs'

export interface Site { id: string; name: string; category: string; last_title: string | null; last_at: string | null; today: number }
export type View = { kind: 'top' } | { kind: 'category'; category: string } | { kind: 'site'; site: Site }
export interface Rubric { cat: string; key: string; short: string; group: GroupId; sites: Site[]; today: number }
export interface Group { id: GroupId; rubrics: Rubric[]; today: number }

/** Ce que chaque thème reçoit : données rangées selon l'utilisateur, vue courante et réglages. */
export interface Nav {
  t: ReturnType<typeof useT>
  rubrics: Rubric[]
  groups: Group[]
  /** Sites visibles (sources coupées exclues), A-Z. */
  sites: Site[]
  view: View
  pick: (v: View) => void
  prefs: NewsPrefs
  update: (patch: Partial<NewsPrefs>) => void
  /** Déplace la rubrique `cat` au rang `to` parmi `subset` (rubriques affichées ensemble). */
  move: (subset: string[], cat: string, to: number) => void
  seen: number
  isFolded: (id: string, dflt: boolean) => boolean
  toggleFold: (id: string, dflt: boolean) => void
  /** Ouvre le panneau de réglages (molette). */
  openSettings: (section?: 'order' | 'sources') => void
}

export const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)

/** Accents de groupe (seules couleurs fixes de la page). */
export const GROUP_COLOR: Record<GroupId, string> = {
  tech: '#5865f2', societe: '#3ba55c', divert: '#eb459e', youtube: '#ed4245', bonsplans: '#faa81a', autres: 'rgb(var(--fc-muted-rgb))',
}
export const GROUP_ICON: Record<GroupId, LucideIcon> = { tech: Cpu, societe: Globe, divert: Clapperboard, youtube: Youtube, bonsplans: Tag, autres: Folder }

const ICONS: [string, LucideIcon][] = [
  ['informatique', Monitor], ['securite', Shield], ['ia', Sparkles], ['presse', Newspaper], ['actualite', Globe], ['actu', Globe],
  ['sciences', Atom], ['sport', Trophy], ['jeux', Gamepad2], ['film', Film], ['serie', Tv], ['manga', BookOpen],
  ['musique', Music], ['bon plan', Tag], ['divertissement', Smile], ['cuisine', ChefHat],
]
export function rubricIcon(cat: string): LucideIcon {
  const k = key(short(cat))
  return ICONS.find(([p]) => k === p || k.startsWith(p + ' ') || (p.length > 2 && k.startsWith(p)))?.[1] ?? Newspaper
}
export function RubricIcon({ cat, size = 15, className = '' }: { cat: string; size?: number; className?: string }) {
  const I = rubricIcon(cat)
  return <I size={size} className={`flex-shrink-0 ${className}`} aria-hidden />
}
/** Icône de rubrique sur fond de la couleur de son groupe (tuiles, dossiers). */
export function RubricBadge({ r, size = 30 }: { r: Pick<Rubric, 'cat' | 'group'>; size?: number }) {
  return (
    <span className="flex-shrink-0 inline-flex items-center justify-center rounded-lg text-white" style={{ width: size, height: size, background: GROUP_COLOR[r.group] }}>
      <RubricIcon cat={r.cat} size={Math.round(size * 0.55)} />
    </span>
  )
}

/** Pastille de site : pas d'image de chaîne côté serveur, donc initiale sur une teinte stable. */
export function Avatar({ name, size = 20, dot }: { name: string; size?: number; dot?: boolean }) {
  return (
    <span className="relative flex-shrink-0 inline-flex items-center justify-center rounded-full font-bold text-white ring-2 ring-fc-channel"
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.45)), background: `hsl(${hue(name)} 45% 32%)` }} aria-hidden>
      {name.trim().charAt(0).toUpperCase()}
      {dot && <span className="absolute -top-0.5 -right-0.5 rounded-full bg-fc-red ring-2 ring-fc-channel" style={{ width: size * 0.32, height: size * 0.32 }} />}
    </span>
  )
}
export function Avatars({ sites, n = 3, size = 18 }: { sites: Site[]; n?: number; size?: number }) {
  return <span className="flex -space-x-1.5">{sites.slice(0, n).map(s => <Avatar key={s.id} name={s.name} size={size} />)}</span>
}

/** Compteur d'articles du jour (vide si zéro). */
export function Count({ n, muted }: { n: number; muted?: boolean }) {
  if (!n) return null
  return <span className={`flex-shrink-0 text-[10px] font-bold rounded-full px-1.5 leading-4 ${muted ? 'text-fc-accent' : 'bg-fc-accent text-white'}`}>{n}</span>
}

/** Nouveauté : dernier article du site plus récent que la dernière visite. */
export const isFresh = (s: Site, seen: number) => seen > 0 && !!s.last_at && new Date(s.last_at).getTime() > seen

export const isCurrent = (v: View, r: { cat: string } | Site) =>
  'id' in r ? v.kind === 'site' && v.site.id === r.id : v.kind === 'category' && v.category === r.cat

/** Glisser-déposer dans une liste (souris) ; le clavier et le tactile passent par les flèches ↑↓. */
export function useDrag(onMove: (id: string, to: number) => void) {
  const [drag, setDrag] = useState<string | null>(null)
  const item = (id: string, idx: number) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => { e.dataTransfer.effectAllowed = 'move'; e.stopPropagation(); setDrag(id) },
    onDragEnd: () => setDrag(null),
    onDragOver: (e: DragEvent) => { if (drag) e.preventDefault() },
    onDrop: (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); if (drag && drag !== id) onMove(drag, idx); setDrag(null) },
  })
  return { drag, item }
}

/** Boutons ↑↓ (réordonner sans souris). */
export function UpDown({ onUp, onDown, label }: { onUp?: () => void; onDown?: () => void; label: string }) {
  const b = 'w-6 h-6 inline-flex items-center justify-center rounded bg-fc-hover/60 text-fc-muted hover:text-white disabled:opacity-30'
  return (
    <span className="flex gap-1 flex-shrink-0">
      <button type="button" className={b} onClick={onUp} disabled={!onUp} aria-label={`${label} ↑`}><ChevronUp size={13} /></button>
      <button type="button" className={b} onClick={onDown} disabled={!onDown} aria-label={`${label} ↓`}><ChevronDown size={13} /></button>
    </span>
  )
}

/** Petit titre de section en capitales. */
export function Label({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-2 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-fc-muted">
      <span className="truncate">{children}</span>{right && <span className="normal-case tracking-normal font-normal flex-shrink-0">{right}</span>}
    </div>
  )
}

/** Ligne de navigation standard (rubrique ou site), surlignée si courante. */
export const rowCls = (on: boolean) =>
  `w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left ${on ? 'bg-fc-hover text-white' : 'text-fc-text hover:bg-fc-hover/60'}`
