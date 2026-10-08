import { useQuery } from '@tanstack/react-query'
import { adminApi, type AdminInfo } from '@/api/admin'

const NONE: AdminInfo = { admin: false, owner: false }

/** Accès à l'administration (rôle El Patron). Le serveur tranche : 403 sinon. */
export function useSiteAdmin(): AdminInfo {
  const q = useQuery({ queryKey: ['site-admin-me'], queryFn: adminApi.me, staleTime: 5 * 60_000, retry: false })
  return q.data ?? NONE
}
