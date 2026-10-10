import { useEffect, useState } from 'react'
import { http } from '@/lib/http'
import { resolveMediaUrl } from '@/lib/links'
import { createUploadSigner } from './uploadSign'

// Instance de l'appli (lib/uploadSign.ts) : URL de /uploads tirées d'un contenu chiffré.
const signer = createUploadSigner({
  post: async (paths) => (await http.post<{ urls?: Record<string, string> }>('/uploads/sign', { urls: paths }, { timeoutMs: 15_000 }))?.urls ?? {},
})

/** URL signée d'un fichier de /uploads (toute autre adresse est rendue telle quelle). */
export const signUpload = signer.sign
/** Après un envoi de forum : `signed_url` connue, aucune requête pour l'aperçu. */
export const primeSignedUpload = signer.prime

/** Adresse affichable (`resolveMediaUrl`) d'un média ; null le temps de la signature. */
export function useSignedMediaUrl(url: string | null | undefined): string | null {
  const ready = url ? signer.cached(url) : undefined
  const [got, setGot] = useState<{ url: string; signed: string } | null>(null)
  useEffect(() => {
    if (!url || ready !== undefined) return
    let alive = true
    void signer.sign(url).then((signed) => {
      if (alive) setGot({ url, signed })
    })
    return () => {
      alive = false
    }
  }, [url, ready])
  return resolveMediaUrl(ready ?? (got && got.url === url ? got.signed : undefined))
}
