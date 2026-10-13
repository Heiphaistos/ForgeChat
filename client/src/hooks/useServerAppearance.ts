import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'
import {
  cleanAppearance, effectiveAppearance, isOptedOut, OPT_EVENT, type ServerAppearance,
} from '../lib/serverAppearance'

/** Refus de l'apparence de ce serveur par le membre (réactif). */
export function useLookOptOut(serverId: string | undefined): boolean {
  const [off, setOff] = useState(() => isOptedOut(serverId))
  useEffect(() => {
    const update = () => setOff(isOptedOut(serverId))
    update()
    window.addEventListener(OPT_EVENT, update)
    return () => window.removeEventListener(OPT_EVENT, update)
  }, [serverId])
  return off
}

/** Version courante des refus (pour les listes de serveurs : le rail). */
export function useLookOptOutTick(): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const update = () => setTick(n => n + 1)
    window.addEventListener(OPT_EVENT, update)
    return () => window.removeEventListener(OPT_EVENT, update)
  }, [])
  return tick
}

/**
 * Apparence du serveur appliquée chez ce membre, depuis le cache ['server', id] (même clé
 * et même requête que ChannelSidebar) ; null hors serveur, sans apparence, ou refusée.
 */
export function useServerAppearance(serverId: string | undefined): ServerAppearance | null {
  const { data } = useQuery<{ server?: { look?: unknown } }>({
    queryKey: ['server', serverId],
    queryFn: () => api.get(`/servers/${serverId}`).then(r => r.data),
    enabled: !!serverId,
    staleTime: 60_000,
  })
  const off = useLookOptOut(serverId)
  const raw = data?.server?.look
  return useMemo(() => effectiveAppearance(cleanAppearance(raw), off), [raw, off])
}
