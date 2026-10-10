import { useEffect, useState } from 'react'
import api, { mediaUrl } from '../api/client'
import { createUploadSigner } from './uploadSign'

// Instance de l'appli (lib/uploadSign.ts) : URL de /uploads tirées d'un contenu chiffré.
const signer = createUploadSigner({
  post: async paths => (await api.post<{ urls?: Record<string, string> }>('/uploads/sign', { urls: paths }, { timeout: 15_000 })).data.urls ?? {},
})

/** URL signée d'un fichier de /uploads (toute autre adresse est rendue telle quelle). */
export const signUpload = signer.sign
/** Après un envoi de forum : `signed_url` connue, aucune requête pour l'aperçu. */
export const primeSignedUpload = signer.prime

/** Adresse affichable (`mediaUrl`) d'un média ; undefined le temps de la signature. */
export function useSignedUrl(url: string | null | undefined): string | undefined {
  const ready = url ? signer.cached(url) : undefined
  const [got, setGot] = useState<{ url: string; signed: string } | null>(null)
  useEffect(() => {
    if (!url || ready !== undefined) return
    let alive = true
    void signer.sign(url).then(signed => { if (alive) setGot({ url, signed }) })
    return () => { alive = false }
  }, [url, ready])
  return mediaUrl(ready ?? (got && got.url === url ? got.signed : undefined))
}
