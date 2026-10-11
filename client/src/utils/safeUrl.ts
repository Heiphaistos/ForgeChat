// Adresses venues d'un message, d'un flux ou du serveur : schéma filtré, liens masqués trompeurs.
// Aucun import : testé par `node --test scripts/safeUrl.test.mjs` (même logique que mobile/src/lib/safeUrl.ts).

/** Seules http(s) sont ouvrables (pas de javascript:, data:, file:…). */
export function isSafeUrl(url: string | null | undefined): url is string {
  if (!url) return false
  try {
    const p = new URL(url)
    return p.protocol === 'https:' || p.protocol === 'http:'
  } catch {
    return false
  }
}

/** `url` si elle est http(s), sinon undefined (pour un `href`). */
export const safeHref = (url: string | null | undefined) => (isSafeUrl(url) ? url : undefined)

const bare = (h: string) => h.toLowerCase().replace(/^www\./, '')

/**
 * Lien masqué [texte](cible) : si le texte ressemble à une adresse d'un AUTRE hôte que la
 * cible (« paypal.com » qui mène ailleurs), rend l'hôte réel à afficher ; sinon null.
 */
export function deceptiveHost(label: string, href: string): string | null {
  let real: string
  try { real = new URL(href).hostname } catch { return null }
  const m = label.match(/((?:[\p{L}\p{N}-]+\.)+\p{L}{2,})/u)
  if (!m) return null
  let shown: string
  try { shown = new URL(`http://${m[1]}`).hostname } catch { return real } // texte d'adresse invalide : on montre la cible
  const r = bare(real)
  const s = bare(shown)
  return r === s || r.endsWith(`.${s}`) ? null : real
}

const RASTER_DATA = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp)[;,]/i

/**
 * Adresse de média (avatar, pièce jointe, emoji, bannière) affichable ET ouvrable : chemin de
 * l'origine courante, http(s), blob: (fichier déchiffré) ou image matricielle data:. Refusés :
 * javascript:/vbscript:, data:text/html, data:image/svg+xml (script), et les faux chemins
 * relatifs que le navigateur lit comme une autre origine (`//h`, `/\h`, `/<tab>/h`).
 */
export function isMediaUrl(u: string | null | undefined): u is string {
  if (!u) return false
  try {
    if (u.startsWith('/')) return new URL(u, 'http://origine.invalid').host === 'origine.invalid'
    const p = new URL(u).protocol
    return p === 'https:' || p === 'http:' || p === 'blob:' || (p === 'data:' && RASTER_DATA.test(u))
  } catch {
    return false
  }
}

/** `?redirect=` après connexion : chemin de l'appli seulement (pas `//h`, `/\h`, ni schéma), sinon `fallback`. */
export function safeRedirect(path: string | null | undefined, fallback: string): string {
  if (!path?.startsWith('/')) return fallback
  try {
    const u = new URL(path, 'http://origine.invalid')
    return u.host === 'origine.invalid' ? u.pathname + u.search + u.hash : fallback
  } catch {
    return fallback
  }
}
