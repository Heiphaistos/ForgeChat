/**
 * Vérification des mises à jour, publiées par le serveur ForgeChat lui-même (`/desktop/mobile.json`).
 *
 * Vie privée : des requêtes GET anonymes vers le serveur déjà utilisé par l'app (aucun identifiant,
 * aucun cookie) — le manifeste, puis, si une version plus récente est annoncée, SHA256SUMS.txt et sa
 * signature — à l'ouverture de l'app, au plus toutes les 3 heures, et seulement si l'utilisateur ne
 * l'a pas désactivée.
 *
 * Ce que l'app vérifie : la signature Ed25519 hors ligne de SHA256SUMS.txt (clé publique dans
 * releaseKey.ts), et que l'empreinte annoncée pour l'APK/IPA est bien celle de la ligne SIGNÉE.
 * Sinon la mise à jour n'est pas proposée.
 *
 * Ce qu'elle NE vérifie PAS : le fichier lui-même. Il est téléchargé par le navigateur (installer.ts),
 * hors de portée de l'app. Pour l'APK, c'est Android qui protège ensuite : il refuse tout APK signé
 * avec une autre clé que l'app installée. L'utilisateur peut comparer l'empreinte à la main.
 */
import { ed25519 } from '@noble/curves/ed25519.js'
import { RELEASE_PUBLIC_KEY } from './releaseKey'

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
  /** Empreinte SHA-256 (hexadécimal minuscule), identique à la ligne signée de SHA256SUMS.txt. */
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
  publicKey: string = RELEASE_PUBLIC_KEY,
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
    if (!update || compareVersions(update.version, currentVersion) <= 0) return null
    await verifySignedUpdate(update, manifestUrl, fetchImpl, controller.signal, publicKey)
    return update
  } finally {
    clearTimeout(timer)
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.trim())
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

const SUMS_LINE = /^([0-9a-f]{64}) [ *](.+)$/i

/**
 * Lève une erreur si la liste signée ne confirme pas `update` : signature Ed25519 de SHA256SUMS.txt
 * invalide, fichier absent de la liste, ou empreinte différente de celle du manifeste.
 * Le nom du fichier doit porter la version annoncée (pas de resservice d'une ancienne release signée).
 */
export function checkSignedSums(update: AvailableUpdate, sums: Uint8Array, signatureB64: string, publicKeyB64: string): void {
  let valid = false
  try {
    valid = ed25519.verify(base64ToBytes(signatureB64), sums, base64ToBytes(publicKeyB64))
  } catch {
    valid = false
  }
  if (!valid) throw new Error('signature de la mise à jour invalide')
  const name = new URL(update.url).pathname.split('/').pop() ?? ''
  if (name !== `ForgeChat-${update.version}.apk` && name !== `ForgeChat-${update.version}.ipa`) {
    throw new Error('nom de fichier inattendu : ' + name)
  }
  const line = new TextDecoder()
    .decode(sums)
    .split(/\r?\n/)
    .map((l) => l.match(SUMS_LINE))
    .find((m) => m?.[2] === name)
  if (!line) throw new Error(name + ' absent de la liste signée')
  if (line[1]?.toLowerCase() !== update.sha256) throw new Error(name + ' : empreinte différente de la liste signée')
}

async function verifySignedUpdate(
  update: AvailableUpdate,
  manifestUrl: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  publicKey: string,
): Promise<void> {
  const sumsUrl = new URL(`/desktop/mobile-v${update.version}.SHA256SUMS.txt`, manifestUrl).href
  const get = async (url: string) => {
    const res = await fetchImpl(url, { method: 'GET', credentials: 'omit', signal, headers: { 'Cache-Control': 'no-cache' } })
    if (!res.ok) throw new Error(`liste signée indisponible (${res.status})`)
    return res
  }
  const sums = new Uint8Array(await (await get(sumsUrl)).arrayBuffer())
  const signature = await (await get(sumsUrl + '.sig')).text()
  checkSignedSums(update, sums, signature, publicKey)
}

/** L'APK téléchargé est-il bien celui annoncé ? (empreintes hexadécimales de 64 caractères, casse ignorée) */
export function shaMatches(expected: string, actual: string): boolean {
  return /^[0-9a-f]{64}$/i.test(expected) && expected.toLowerCase() === actual.toLowerCase()
}
