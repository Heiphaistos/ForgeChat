import { useQuery } from '@tanstack/react-query'
import api from '../api/client'

const fetchImage = (url: string) => api.get('/og/image', { params: { url }, responseType: 'blob', timeout: 10_000 })
  .then(r => URL.createObjectURL(r.data as Blob))

/**
 * Avatar Discord d'un message importé dont l'auteur a changé d'avatar depuis : l'ancienne adresse répond 404.
 * Repli sur l'avatar par défaut de Discord pour cet identifiant, plutôt qu'un carré vide.
 */
export function discordDefaultAvatar(url: string): string | null {
  const m = url.match(/^https:\/\/cdn\.discordapp\.com\/avatars\/(\d{15,21})\//)
  return m ? `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(m[1]) >> 22n) % 6n)}.png` : null
}

/**
 * Image distante récupérée par le serveur (GET /og/image, jeton d'accès requis : donc via axios, en
 * blob) : le site d'origine ne voit jamais l'IP du lecteur et la CSP n'a pas besoin de `img-src https:`.
 * `null` tant que l'image n'est pas là ou si elle est refusée (pas une image, trop grosse, hôte privé).
 */
export function useProxiedImage(src: string | null | undefined): string | null {
  const { data } = useQuery<string | null>({
    queryKey: ['og-image', src],
    queryFn: () => fetchImage(src!).catch(() => {
      const fallback = discordDefaultAvatar(src!)
      if (!fallback) throw new Error('image indisponible')
      return fetchImage(fallback)
    }),
    enabled: !!src,
    staleTime: Infinity,
    gcTime: 600_000,
    retry: false,
  })
  // ponctuel : l'URL blob (3 Mo au plus) reste valide tant que la requête est en cache ; pas de revoke.
  return data ?? null
}
