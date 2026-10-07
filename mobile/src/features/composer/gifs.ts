import { t } from '@/i18n'
/**
 * Recherche de GIF via le serveur (GIPHY, KLIPY, ou Wikimedia Commons sans clé). Le serveur ne renvoie que
 * des images de ces CDN, sans paramètres ; l'app le revérifie avant d'afficher ou d'envoyer quoi que
 * ce soit (même liste que server/src/handlers/gifs.rs).
 */

export interface GifResult {
  id: string
  title: string
  /** Envoyé tel quel comme contenu du message (comme le web). */
  url: string
  /** Petite version animée pour la grille. */
  preview: string
  width: number
  height: number
}

const GIF_HOST = /^(?:media\d?\.giphy\.com|i\.giphy\.com|static\d{0,2}\.klipy\.com|upload\.wikimedia\.org|thumb\.wikimedia\.org)$/

/** Image d'un CDN de GIF connu, en https, sans port, identifiants ni paramètres. */
export function isGifMediaUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 500) return false
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && !u.port && !u.username && !u.password && !u.search && GIF_HOST.test(u.hostname) &&
      /\.(gif|webp)$/i.test(u.pathname) && !/[\s"'<>]/.test(raw)
  } catch {
    return false
  }
}

/** GET /gifs/status : la recherche n'est proposée que si le serveur l'a activée. */
export function gifSearchEnabled(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && (raw as { enabled?: unknown }).enabled === true
}

/** Texte du champ de recherche et mention de la source (exigée par GIPHY), fournis par le serveur. */
export function gifSource(raw: unknown): { placeholder: string; attribution: string } {
  const r = (raw ?? {}) as { search_placeholder?: unknown; attribution?: unknown }
  const txt = (v: unknown, d: string) => (typeof v === 'string' && v.length <= 60 ? v : d)
  return { placeholder: txt(r.search_placeholder, t('panel.gif.searchDefault')), attribution: txt(r.attribution, '') }
}

/** GET /gifs/search|trending → résultats valides et jeton de page suivante. */
export function parseGifResults(raw: unknown): { results: GifResult[]; next: string | null } {
  const r = (raw ?? {}) as { results?: unknown; next?: unknown }
  const results: GifResult[] = []
  if (Array.isArray(r.results)) {
    for (const g of r.results as Record<string, unknown>[]) {
      if (!isGifMediaUrl(g?.url)) continue
      const preview = isGifMediaUrl(g.preview) ? g.preview : g.url
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(v, 4096) : 0)
      results.push({
        id: typeof g.id === 'string' ? g.id.slice(0, 64) : g.url,
        title: typeof g.title === 'string' ? g.title.slice(0, 120) : '',
        url: g.url,
        preview,
        width: num(g.width),
        height: num(g.height),
      })
    }
  }
  // Décalage (GIPHY, Wikimedia) ou jeton opaque KLIPY (base64, ex. « Mg== »).
  const next = typeof r.next === 'string' && /^[A-Za-z0-9._=+\/-]{1,64}$/.test(r.next) && !r.next.includes('..') ? r.next : null
  return { results, next }
}
