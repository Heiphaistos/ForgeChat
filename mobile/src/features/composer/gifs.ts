/**
 * Recherche de GIF via le serveur (KLIPY). Le serveur ne renvoie que des images de son CDN ; l'app
 * le revérifie avant d'afficher ou d'envoyer quoi que ce soit.
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

const KLIPY_HOST = /^static\d{0,2}\.klipy\.com$/

/** Image du CDN KLIPY, en https, sans port ni identifiants. */
export function isKlipyMediaUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 500) return false
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && !u.port && !u.username && !u.password && KLIPY_HOST.test(u.hostname) && !/[\s"'<>]/.test(raw)
  } catch {
    return false
  }
}

/** GET /gifs/status : la recherche n'est proposée que si le serveur l'a activée (patch + clé). */
export function gifSearchEnabled(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && (raw as { enabled?: unknown }).enabled === true
}

/** GET /gifs/search|trending → résultats valides et jeton de page suivante. */
export function parseGifResults(raw: unknown): { results: GifResult[]; next: string | null } {
  const r = (raw ?? {}) as { results?: unknown; next?: unknown }
  const results: GifResult[] = []
  if (Array.isArray(r.results)) {
    for (const g of r.results as Record<string, unknown>[]) {
      if (!isKlipyMediaUrl(g?.url)) continue
      const preview = isKlipyMediaUrl(g.preview) ? g.preview : g.url
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
  const next = typeof r.next === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(r.next) ? r.next : null
  return { results, next }
}
