import { useQuery } from '@tanstack/react-query'
import api from '../api/client'

/** Vrai pour un administrateur du site (FORGECHAT_ADMIN_USER_IDS ou droit accordé). Le serveur tranche : 403 sinon. */
export function useSiteAdmin(): boolean {
  const { data } = useQuery<boolean>({
    queryKey: ['site-admin-me'],
    queryFn: () => api.get('/admin/me').then(() => true, () => false),
    staleTime: 5 * 60_000,
    retry: false,
  })
  return !!data
}
