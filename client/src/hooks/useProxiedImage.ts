import { useQuery } from '@tanstack/react-query'
import api from '../api/client'

/**
 * Image distante récupérée par le serveur (GET /og/image, jeton d'accès requis : donc via axios, en
 * blob) : le site d'origine ne voit jamais l'IP du lecteur et la CSP n'a pas besoin de `img-src https:`.
 * `null` tant que l'image n'est pas là ou si elle est refusée (pas une image, trop grosse, hôte privé).
 */
export function useProxiedImage(src: string | null | undefined): string | null {
  const { data } = useQuery<string | null>({
    queryKey: ['og-image', src],
    queryFn: () => api.get('/og/image', { params: { url: src }, responseType: 'blob', timeout: 10_000 })
      .then(r => URL.createObjectURL(r.data as Blob)),
    enabled: !!src,
    staleTime: Infinity,
    gcTime: 600_000,
    retry: false,
  })
  // ponctuel : l'URL blob (3 Mo au plus) reste valide tant que la requête est en cache ; pas de revoke.
  return data ?? null
}
