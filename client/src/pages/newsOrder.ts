// Rubriques de la page Actualités : nom affiché et ordre (familles par défaut, puis choix de l'utilisateur).
/** Rubrique affichée : sans les décorations des noms de forum (⭒, emoji, lettres en gras Unicode). */
export const clean = (s: string) => s.normalize('NFKC').replace(/[⭒•·]/g, '').replace(/\p{Extended_Pictographic}/gu, '').replace(/-/g, ' ').trim()
/** Ordre par défaut des rubriques, par familles (Tech, Société, Divertissement, YouTube, bons plans). */
const DEFAULT_ORDER = ['informatique', 'securite', 'ia', 'presse', 'actualite', 'sciences', 'sport', 'jeux', 'film', 'serie', 'manga', 'musique', 'youtube', 'bon plan']
export const key = (s: string) => clean(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
/** Rubriques rangées dans l'ordre choisi (glisser-déposer), puis les autres dans l'ordre par défaut. */
export function orderCategories(cats: string[], saved: string[]): string[] {
  const rank = (c: string) => {
    const i = saved.indexOf(key(c))
    if (i >= 0) return i
    const d = DEFAULT_ORDER.findIndex(p => key(c).startsWith(p))
    return 1000 + (d >= 0 ? d : DEFAULT_ORDER.length)
  }
  return [...cats].sort((a, b) => rank(a) - rank(b) || clean(a).localeCompare(clean(b)))
}

/** Groupes de navigation (dossiers, onglets, colonnes) : chaque rubrique appartient à un seul. */
export const GROUPS = ['tech', 'societe', 'divert', 'youtube', 'bonsplans', 'autres'] as const
export type GroupId = typeof GROUPS[number]
const GROUP_OF: [string, GroupId][] = [
  ['youtube', 'youtube'], ['informatique', 'tech'], ['securite', 'tech'], ['ia', 'tech'],
  ['presse', 'societe'], ['actualite', 'societe'], ['sciences', 'societe'], ['sport', 'societe'],
  ['jeux', 'divert'], ['film', 'divert'], ['serie', 'divert'], ['manga', 'divert'], ['musique', 'divert'],
  ['bon plan', 'bonsplans'],
]
/** Groupe d'une rubrique (« IA » seulement en mot entier) ; inconnue : « Autres ». */
export function groupOf(cat: string): GroupId {
  const k = key(cat)
  for (const [p, g] of GROUP_OF) if (k === p || k.startsWith(p + ' ') || (p.length > 2 && k.startsWith(p))) return g
  return 'autres'
}
/** Nom court dans son groupe : « YouTube · Jeux vidéo » devient « Jeux vidéo ». */
export const short = (cat: string) => clean(cat).replace(/^youtube\s*/i, '') || clean(cat)

/** Déplace `item` au rang `to` d'un sous-ensemble de `all` ; les rubriques hors sous-ensemble gardent leur place. */
export function moveWithin(all: string[], subset: string[], item: string, to: number): string[] {
  const sub = subset.filter(c => c !== item)
  sub.splice(Math.max(0, Math.min(to, sub.length)), 0, item)
  const slots = new Set(subset)
  let i = 0
  return all.map(c => (slots.has(c) ? sub[i++] : c))
}
