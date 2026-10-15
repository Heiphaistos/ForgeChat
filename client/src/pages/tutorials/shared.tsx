// Types du contrat /api/tutorials et petits éléments communs à la liste et au détail.
import { AppWindow, BookOpen, Code2, Flame, Laptop, MessagesSquare, Monitor, Network, Package, ShieldCheck, Smartphone, SquareTerminal, Terminal, type LucideIcon } from 'lucide-react'

export interface CategoryRef { slug: string; name: string; icon?: string }
export interface Group { key: string; label: string; count: number }
export interface Category extends CategoryRef { count: number; groups: Group[] }
export interface Tutorial {
  slug: string; title: string; description: string; category: CategoryRef; group: string | null
  tags: string[]; video_url: string; thumbnail_url?: string | null; created_at: string; content_html?: string
}
export interface TutorialPage { items: Tutorial[]; total: number; page: number; per_page: number }

const ICONS: [RegExp, LucideIcon][] = [
  [/heiphaistos/, Flame], [/android/, Smartphone], [/cmd|powershell|shell/, SquareTerminal], [/discord/, MessagesSquare],
  [/linux/, Terminal], [/logiciel/, Package], [/programmation|dev|code/, Code2], [/r[eé]seau|network/, Network],
  [/s[eé]curit/, ShieldCheck], [/windows/, Monitor], [/mac/, Laptop], [/application|app/, AppWindow],
]
export const categoryIcon = (slug: string): LucideIcon => ICONS.find(([re]) => re.test(slug.toLowerCase()))?.[1] ?? BookOpen

/** Teinte stable d'une catégorie (dégradé des cartes et pastilles). */
export const hueOf = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
export const tint = (s: string) => `linear-gradient(135deg, hsl(${hueOf(s)} 55% 36%), hsl(${(hueOf(s) + 45) % 360} 55% 22%))`
