// Mots de passe ayant fuité (audit 2026-10-12, amélioration n° 6) — k-anonymat de
// Have I Been Pwned : seuls les 5 premiers caractères du SHA-1 partent (via notre serveur,
// /api/auth/pwned-range/:prefix) ; la comparaison de la suite se fait ici. Le mot de passe ne
// quitte jamais l'appareil. Service injoignable : on n'empêche rien (les autres règles restent).
// Testé par `node --test scripts/pwned.test.mjs`.

import { intlLocale, t } from '../i18n/index.ts'

export type RangeFetcher = (prefix: string) => Promise<string>

async function sha1Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}

/** Nombre d'apparitions dans les fuites connues (0 : absent), null si la vérification a échoué. */
export async function pwnedCount(pw: string, fetchRange: RangeFetcher): Promise<number | null> {
  try {
    const hash = await sha1Hex(pw)
    const body = await fetchRange(hash.slice(0, 5))
    const suffix = hash.slice(5)
    for (const line of body.split('\n')) {
      const [s, n] = line.trim().split(':')
      if (s?.toUpperCase() === suffix) return Number(n) || 0
    }
    return 0
  } catch {
    return null
  }
}

/** Message d'erreur si le mot de passe a fuité, sinon null. */
export async function pwnedProblem(pw: string, fetchRange?: RangeFetcher): Promise<string | null> {
  const fetcher = fetchRange ?? (async (prefix: string) => {
    const { default: api } = await import('../api/client')
    return (await api.get<string>(`/auth/pwned-range/${prefix}`, { responseType: 'text', timeout: 8000 })).data
  })
  const n = await pwnedCount(pw, fetcher)
  if (!n) return null
  return t(n > 1 ? 'e2e.pw.leaked.other' : 'e2e.pw.leaked.one', { n: n.toLocaleString(intlLocale()) })
}
