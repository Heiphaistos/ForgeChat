// URL signées des fichiers de /uploads (F8, audit 2026-10-10 ; server/src/upload_sign.rs).
// Hors dossiers publics, le serveur ne sert un fichier qu'avec `?exp=&sig=`. Les pièces jointes
// renvoyées par l'API sont déjà signées ; les adresses écrites DANS un contenu chiffré (médias de
// forum et de fil, entrées `f.u`) restent brutes et sont signées à l'affichage par
// `POST /api/uploads/sign` : lots de 100 au plus, cache par chemin brut jusqu'à exp - 10 min,
// une seule requête en vol par chemin. Même logique que client/src/lib/uploadSign.ts ;
// testée par __tests__/upload-sign.test.ts.

/** Sans la requête (`/uploads/x.enc?exp=…&sig=…` → `/uploads/x.enc`) ; voir aussi lib/links.uploadPath. */
const bare = (url: string) => url.split('?')[0] ?? url

/** Dossiers servis sans signature (même liste que le serveur). */
const PUBLIC_PREFIXES = ['avatars/', 'banners/', 'member_profiles/', 'server-icons/', 'server-banners/',
  'emojis/', 'stickers/', 'sounds/', 'role-icon-']

/** Requête de signature : 100 URL au plus (limite serveur). */
export const SIGN_BATCH = 100
const MARGIN_MS = 10 * 60_000

/** Chemin brut à faire signer, ou null : autre adresse, dossier public ou déjà signée. */
export function unsignedUpload(url: string): string | null {
  if (!url.startsWith('/uploads/') || url.includes('..') || /[?&]sig=/.test(url)) return null
  const path = bare(url)
  return PUBLIC_PREFIXES.some(p => path.startsWith(`/uploads/${p}`)) ? null : path
}

/** Échéance (ms) d'une URL signée, 0 si absente. */
export const signedExpiry = (signed: string) => Number(signed.match(/[?&]exp=(\d+)/)?.[1] ?? 0) * 1000

export interface SignerDeps {
  /** `POST /uploads/sign {urls}` → `urls` (chemins refusés omis). */
  post: (paths: string[]) => Promise<Record<string, string>>
  now?: () => number
  /** Regroupe les demandes d'un même rendu en un seul envoi. */
  schedule?: (flush: () => void) => void
}

export function createUploadSigner({ post, now = Date.now, schedule = f => void setTimeout(f, 0) }: SignerDeps) {
  const cache = new Map<string, { url: string; until: number }>()
  const inflight = new Map<string, Promise<string>>()
  let queue = new Map<string, (signed: string | null) => void>()

  const flush = () => {
    const batch = queue
    queue = new Map()
    const paths = [...batch.keys()]
    for (let i = 0; i < paths.length; i += SIGN_BATCH) {
      const chunk = paths.slice(i, i + SIGN_BATCH)
      // Échec réseau ou refus : adresse brute (non mise en cache, redemandée au prochain affichage).
      void post(chunk).catch(() => ({} as Record<string, string>)).then(res => {
        for (const p of chunk) {
          const s = res[p]
          batch.get(p)!(typeof s === 'string' && bare(s) === p ? s : null)
        }
      })
    }
  }

  /** URL signée déjà connue (envoi de forum : `signed_url`). */
  const prime = (raw: string, signed: string) => {
    const path = unsignedUpload(raw)
    const until = signedExpiry(signed) - MARGIN_MS
    if (path && bare(signed) === path && until > now()) cache.set(path, { url: signed, until })
  }

  /** Adresse affichable tout de suite, sans requête ; undefined = à signer. */
  const cached = (url: string): string | undefined => {
    const path = unsignedUpload(url)
    if (!path) return url
    const hit = cache.get(path)
    return hit && hit.until > now() ? hit.url : undefined
  }

  const sign = (url: string): Promise<string> => {
    const ready = cached(url)
    if (ready !== undefined) return Promise.resolve(ready)
    const path = unsignedUpload(url)!
    let p = inflight.get(path)
    if (!p) {
      p = new Promise<string | null>(resolve => {
        if (!queue.size) schedule(flush)
        queue.set(path, resolve)
      }).then(signed => {
        inflight.delete(path)
        if (!signed) return url
        prime(path, signed)
        return signed
      })
      inflight.set(path, p)
    }
    return p
  }

  return { sign, prime, cached }
}
