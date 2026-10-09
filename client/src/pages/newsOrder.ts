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
