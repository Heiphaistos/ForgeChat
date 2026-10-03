/**
 * Vérification des mises à jour de la bêta, distribuée par les releases GitHub.
 *
 * Vie privée : une seule requête GET anonyme vers l'API publique de GitHub (aucun identifiant,
 * aucun cookie, aucune donnée de l'app) au plus une fois par jour, et seulement si l'utilisateur
 * ne l'a pas désactivée. GitHub voit l'adresse IP, comme pour toute visite de la page des releases.
 * Rien n'est téléchargé ni installé automatiquement : l'app propose d'ouvrir la page de la release.
 */

/** Intervalle minimal entre deux vérifications automatiques. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const TIMEOUT_MS = 10_000

export interface AvailableUpdate {
  version: string
  /** Page de la release sur github.com (jamais un lien direct vers l'APK). */
  url: string
}

const VERSION = /^v?(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/

/** « 1.2.3 » / « v1.2.3 » → [1, 2, 3] ; null si le format n'est pas strictement X.Y.Z. */
export function parseVersion(v: string): [number, number, number] | null {
  const m = VERSION.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** > 0 si `a` est plus récente que `b`, 0 si égales, < 0 sinon (versions invalides : 0). */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return 0
  const [a1, a2, a3] = pa
  const [b1, b2, b3] = pb
  return a1 - b1 || a2 - b2 || a3 - b3
}

/**
 * Lit la réponse de `GET /repos/{repo}/releases/latest`. N'accepte qu'une release publiée
 * (ni brouillon, ni pré-version), au numéro X.Y.Z, dont la page est bien sur ce dépôt.
 */
export function parseLatestRelease(json: unknown, repo: string): AvailableUpdate | null {
  if (!json || typeof json !== 'object') return null
  const r = json as Record<string, unknown>
  if (r.draft !== false || r.prerelease !== false) return null
  if (typeof r.tag_name !== 'string' || typeof r.html_url !== 'string') return null
  const parsed = parseVersion(r.tag_name)
  if (!parsed) return null
  const prefix = `https://github.com/${repo}/releases/`
  if (!r.html_url.startsWith(prefix) || /[\s"'<>]/.test(r.html_url)) return null
  return { version: parsed.join('.'), url: r.html_url }
}

export function isDue(lastCheckAt: number, now: number): boolean {
  return !(lastCheckAt > 0 && now - lastCheckAt < CHECK_INTERVAL_MS && now >= lastCheckAt)
}

/**
 * Interroge GitHub et renvoie la mise à jour disponible, ou null (à jour, release invalide).
 * Lève une erreur en cas d'échec réseau ou de réponse inattendue.
 */
export async function fetchAvailableUpdate(
  repo: string,
  currentVersion: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AvailableUpdate | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
      method: 'GET',
      headers: { Accept: 'application/vnd.github+json' },
      credentials: 'omit',
      signal: controller.signal,
    })
    // 404 : aucune release publiée pour l'instant.
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`GitHub a répondu ${res.status}`)
    const update = parseLatestRelease(await res.json(), repo)
    return update && compareVersions(update.version, currentVersion) > 0 ? update : null
  } finally {
    clearTimeout(timer)
  }
}
