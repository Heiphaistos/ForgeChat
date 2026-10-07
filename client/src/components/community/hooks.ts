// Accès aux réglages du lot communauté (GET puis PUT) et rôles du serveur.
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../../api/client'
import { useT } from '../../i18n'

export const errText = (e: any, fallback: string) => e?.response?.data?.error ?? fallback

export function useRoles(serverId: string) {
  return useQuery<{ id: string; name: string; is_everyone?: boolean; permissions: number }[]>({
    queryKey: ['roles', serverId],
    queryFn: () => api.get(`/servers/${serverId}/roles`).then(r => r.data),
  })
}

/** GET → état local modifiable → PUT, avec retour visuel. */
export function useSetting<T>(serverId: string, path: string, fallback: T) {
  const t = useT()
  const qc = useQueryClient()
  const q = useQuery<T>({ queryKey: ['community', serverId, path], queryFn: () => api.get(`/servers/${serverId}/${path}`).then(r => r.data) })
  const [local, setLocal] = useState<T>(fallback)
  useEffect(() => { if (q.data) setLocal(q.data) }, [q.data])
  const save = useMutation({
    mutationFn: (v: T) => api.put(`/servers/${serverId}/${path}`, v),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['community', serverId, path] }); toast.success(t('community.saved')) },
    onError: (e: any) => toast.error(errText(e, t('common.error'))),
  })
  return { local, setLocal, save, loading: q.isLoading }
}

