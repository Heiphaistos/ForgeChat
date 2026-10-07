import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { useCallback, useMemo } from 'react'
import { Text } from 'react-native'
import { serversApi } from '@/api/servers'
import { resolveMediaUrl } from '@/lib/links'
import { qk } from '@/lib/queryClient'
import { useServerDetail } from './menus'
import { roleDecorOf, type RoleDecor } from './perms'

/** Habillage par membre d'un serveur (rôles du détail du serveur + liste des membres en cache). */
export function useRoleDecor(serverId: string) {
  const enabled = !!serverId
  const detail = useServerDetail(serverId, enabled)
  const members = useQuery({ queryKey: qk.members(serverId), queryFn: () => serversApi.members(serverId), enabled })
  const map = useMemo(() => {
    const roles = detail.data?.roles ?? []
    const out = new Map<string, RoleDecor>()
    for (const m of members.data ?? []) {
      const d = roleDecorOf(roles, m.role_ids)
      if (d) out.set(m.user_id, d)
    }
    return out
  }, [detail.data, members.data])
  return useCallback((userId: string) => map.get(userId), [map])
}

/** Icône de rôle : image téléversée ou emoji. */
export function RoleIcon({ icon, title, size = 16 }: { icon: string | null | undefined; title?: string | null; size?: number }) {
  if (!icon) return null
  if (icon.startsWith('/uploads/')) {
    const uri = resolveMediaUrl(icon)
    return uri ? <Image source={{ uri }} style={{ width: size, height: size }} contentFit="contain" accessibilityLabel={title ?? undefined} /> : null
  }
  return (
    <Text style={{ fontSize: size - 2 }} accessibilityLabel={title ?? undefined}>
      {icon}
    </Text>
  )
}
