import { useQuery } from '@tanstack/react-query'
import api from '../api/client'

interface SiteAdminInfo { admin: boolean; owner: boolean }

/** Accès à l'administration : rôle « El Patron » (le propriétaire du site l'a d'office). Le serveur tranche : 403 sinon. */
export function useSiteAdminInfo(): SiteAdminInfo {
  const { data } = useQuery<SiteAdminInfo>({
    queryKey: ['site-admin-me'],
    queryFn: () => api.get('/admin/me').then(r => ({ admin: true, owner: !!r.data?.owner }), () => ({ admin: false, owner: false })),
    staleTime: 5 * 60_000,
    retry: false,
  })
  return data ?? { admin: false, owner: false }
}

export function useSiteAdmin(): boolean {
  return useSiteAdminInfo().admin
}
