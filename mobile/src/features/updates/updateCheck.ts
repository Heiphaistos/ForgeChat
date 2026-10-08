/**
 * Vérification des mises à jour, publiées par le serveur ForgeChat lui-même (`/desktop/mobile.json`).
 *
 * Vie privée : une seule requête GET anonyme vers le serveur déjà utilisé par l'app (aucun
 * identifiant, aucun cookie) à l'ouverture de l'app, au plus toutes les 3 heures, et seulement si
 * l'utilisateur ne l'a pas désactivée. L'app télécharge l'APK depuis ce même serveur, en vérifie
 * l'empreinte SHA-256 (installer.ts), puis Android demande confirmation et refuse tout APK qui n'est
 * pas signé avec la même clé que l'app installée.
 */

/**
 * Intervalle minimal entre deux vérifications automatiques. Court : le service de premier plan
 * (« Notifications sans Google ») garde le processus vivant des jours entiers, l'app ne redémarre
 * presque jamais à froid ; la vérification se fait donc aussi à chaque retour au premier plan.
 */
export const CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000
const TIMEOUT_MS = 10_000

export interface AvailableUpdate {
  version: string
  /** APK sur le serveur ForgeChat (même origine que le manifeste, dossier /desktop/). */
  url: string
  /** Empreinte SHA-256 annoncée (hexadécimal minuscule), comparée à celle du fichier téléchargé. */
  sha256: string
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
 * Lit le manifeste `{ version, platforms: { android: { url, sha256 } } }`. N'accepte qu'un numéro
 * X.Y.Z et un APK servi en HTTPS par le même serveur, dans son dossier /desktop/.
 */
export type UpdatePlatform = 'android' | 'ios'

export function parseManifest(json: unknown, manifestUrl: string, platform: UpdatePlatform = 'android'): AvailableUpdate | null {
  if (!json || typeof json !== 'object') return null
  const r = json as Record<string, unknown>
  if (typeof r.version !== 'string') return null
  const parsed = parseVersion(r.version)
  if (!parsed) return null
  // iOS : l'IPA du même manifeste (installée par AltStore / SideStore, installer.ts).
  const entry = (r.platforms as Record<string, unknown> | undefined)?.[platform] as Record<string, unknown> | undefined
  if (!entry || typeof entry.url !== 'string' || typeof entry.sha256 !== 'string') return null
  if (!/^[0-9a-f]{64}$/i.test(entry.sha256)) return null
  let url: URL
  try {
    url = new URL(entry.url, manifestUrl)
  } catch {
    return null
  }
  const base = new URL(manifestUrl)
  if (url.protocol !== 'https:' || url.host !== base.host || !url.pathname.startsWith('/desktop/') || !url.pathname.endsWith(platform === 'ios' ? '.ipa' : '.apk')) {
    return null
  }
  return { version: parsed.join('.'), url: url.href, sha256: entry.sha256.toLowerCase() }
}

export function isDue(lastCheckAt: number, now: number): boolean {
  return !(lastCheckAt > 0 && now - lastCheckAt < CHECK_INTERVAL_MS && now >= lastCheckAt)
}

/**
 * Interroge le serveur et renvoie la mise à jour disponible, ou null (à jour, release invalide).
 * Lève une erreur en cas d'échec réseau ou de réponse inattendue.
 */
export async function fetchAvailableUpdate(
  manifestUrl: string,
  currentVersion: string,
  fetchImpl: typeof fetch = fetch,
  platform: UpdatePlatform = 'android',
): Promise<AvailableUpdate | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetchImpl(manifestUrl, {
      method: 'GET',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      credentials: 'omit',
      signal: controller.signal,
    })
    // 404 : aucune version publiée pour l'instant.
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`le serveur a répondu ${res.status}`)
    const update = parseManifest(await res.json(), manifestUrl, platform)
    return update && compareVersions(update.version, currentVersion) > 0 ? update : null
  } finally {
    clearTimeout(timer)
  }
}

/** L'APK téléchargé est-il bien celui annoncé ? (empreintes hexadécimales de 64 caractères, casse ignorée) */
export function shaMatches(expected: string, actual: string): boolean {
  return /^[0-9a-f]{64}$/i.test(expected) && expected.toLowerCase() === actual.toLowerCase()
}
