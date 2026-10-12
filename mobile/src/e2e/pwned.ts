// Mots de passe ayant fuité (audit 2026-10-12, amélioration n° 6) — même règle que le web
// (client/src/e2e/pwned.ts) : k-anonymat de Have I Been Pwned, seuls les 5 premiers caractères du
// SHA-1 partent (via /api/auth/pwned-range/:prefix), la suite est comparée sur l'appareil.
// Service injoignable : rien n'est bloqué.
import { sha1 } from '@noble/hashes/legacy.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

export type RangeFetcher = (prefix: string) => Promise<string>

export async function pwnedCount(pw: string, fetchRange: RangeFetcher): Promise<number | null> {
  try {
    const hash = bytesToHex(sha1(utf8ToBytes(pw))).toUpperCase()
    const body = await fetchRange(hash.slice(0, 5))
    const suffix = hash.slice(5)
    for (const line of String(body ?? '').split('\n')) {
      const [s, n] = line.trim().split(':')
      if (s?.toUpperCase() === suffix) return Number(n) || 0
    }
    return 0
  } catch {
    return null
  }
}

export async function pwnedProblem(pw: string, fetchRange?: RangeFetcher): Promise<string | null> {
  const fetcher = fetchRange ?? (async (prefix: string) => {
    const { http } = await import('@/lib/http')
    return http.get<string>(`/auth/pwned-range/${prefix}`, { auth: false, timeoutMs: 8000 })
  })
  const n = await pwnedCount(pw, fetcher)
  if (!n) return null
  return `Ce mot de passe figure dans ${n.toLocaleString('fr-FR')} fuite${n > 1 ? 's' : ''} de données connue${n > 1 ? 's' : ''} : les pirates l'essaient en premier. Choisis-en un autre.`
}
