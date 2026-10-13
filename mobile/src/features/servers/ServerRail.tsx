import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Avatar } from '@/components/Avatar'
import { Badge } from '@/components/ui'
import { directUnread, serverUnread, useUnread } from '@/stores/unread'
import type { Server } from '@/types/models'
import { colors, spacing } from '@/theme'
import { useT } from '@/i18n'
import { unreadLabel } from '@/lib/format'
import { http } from '@/lib/http'
import { railEntries, type ServerLayout } from './layout'
import { ServerMenu } from './menus'
import { ServerIconView } from './ServerIconView'
import { cleanLook, hex, iconRadius } from './serverLook'

/**
 * Colonne d'icônes de l'accueil. `selected === null` : « Messages privés ».
 * `onRetry` : affiché à la place des serveurs si leur chargement a échoué.
 */
export function ServerRail({
  servers,
  selected,
  onSelect,
  onRetry,
}: {
  servers: Server[]
  selected: string | null
  onSelect: (id: string | null) => void
  onRetry?: () => void
}) {
  const t = useT()
  const counts = useUnread((s) => s.counts)
  const serverOf = useUnread((s) => s.serverOf)
  const dmActive = selected === null
  const dmUnread = directUnread(counts, serverOf)
  const [menu, setMenu] = useState<Server | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  // Ordre et dossiers choisis sur le web (synchronisés par le compte).
  const layout = useQuery({
    queryKey: ['server-layout'],
    queryFn: () => http.get<ServerLayout | null>('/users/me/server-layout'),
    staleTime: 60_000,
  })
  const entries = useMemo(() => railEntries(servers, layout.data), [servers, layout.data])
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const serverItem = (s: Server) => {
    const active = s.id === selected
    const unread = serverUnread(counts, serverOf, s.id)
    const look = cleanLook(s.look)
    return (
      <Pressable
        key={s.id}
        onPress={() => onSelect(s.id)}
        onLongPress={() => setMenu(s)}
        accessibilityRole="button"
        accessibilityLabel={`${t('rail.server', { name: s.name })}${unread ? `, ${unreadLabel(unread)}` : ''}`}
        accessibilityHint={t('rail.serverHint')}
        accessibilityState={{ selected: active }}
        accessibilityActions={[{ name: 'longpress', label: t('rail.serverOptions') }]}
        onAccessibilityAction={(e) => e.nativeEvent.actionName === 'longpress' && setMenu(s)}
        style={styles.item}
      >
        <View style={[styles.pill, { height: active ? 36 : unread ? 8 : 0 }, look?.unread_color != null && { backgroundColor: hex(look.unread_color) }]} />
        {/* Forme de l'icône choisie dans l'apparence du serveur. */}
        {look?.icon_shape ? (
          <ServerIconView uri={s.icon} name={s.name} size={48} radius={iconRadius(look.icon_shape, 48)} accent={look.accent != null ? hex(look.accent) : undefined} />
        ) : (
          <Avatar uri={s.icon} name={s.name} size={48} rounded={!active} />
        )}
        {unread ? (
          <View style={styles.badge}>
            <Badge count={unread} />
          </View>
        ) : null}
      </Pressable>
    )
  }

  return (
    <View style={styles.rail}>
      <ScrollView contentContainerStyle={{ alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md }} showsVerticalScrollIndicator={false}>
        <Pressable
          onPress={() => onSelect(null)}
          accessibilityRole="button"
          accessibilityLabel={`${t('rail.dms')}${dmUnread ? `, ${unreadLabel(dmUnread)}` : ''}`}
          accessibilityState={{ selected: dmActive }}
          style={styles.item}
        >
          <View style={[styles.pill, { height: dmActive ? 36 : dmUnread ? 8 : 0 }]} />
          <View style={[styles.home, dmActive && styles.homeActive]}>
            <Ionicons name="chatbubbles" size={24} color={dmActive ? '#fff' : colors.textMuted} />
          </View>
          {dmUnread ? (
            <View style={styles.badge}>
              <Badge count={dmUnread} />
            </View>
          ) : null}
        </Pressable>
        {/* Actualités : articles des flux RSS, pour tout le monde */}
        <Pressable onPress={() => router.push('/news')} accessibilityRole="button" accessibilityLabel={t('news.title')} style={styles.item}>
          <View style={styles.home}>
            <Ionicons name="newspaper-outline" size={22} color={colors.textMuted} />
          </View>
        </Pressable>
        <View style={styles.separator} />
        {onRetry ? (
          <Pressable style={styles.add} onPress={onRetry} accessibilityRole="button" accessibilityLabel={t('rail.retry')}>
            <Ionicons name="refresh" size={22} color={colors.danger} />
          </Pressable>
        ) : null}
        {entries.map((e) => {
          if (e.kind === 'server') return serverItem(e.server)
          const expanded = open.has(e.id)
          const unread = e.servers.reduce((n, x) => n + serverUnread(counts, serverOf, x.id), 0)
          return (
            <View key={e.id} style={[styles.folder, expanded && { backgroundColor: colors.bgAlt }]}>
              <Pressable
                onPress={() => toggle(e.id)}
                accessibilityRole="button"
                accessibilityLabel={`${t('rail.folder', { name: e.name, n: e.servers.length })}${unread ? `, ${unreadLabel(unread)}` : ''}`}
                accessibilityState={{ expanded }}
                style={styles.item}
              >
                <View style={[styles.folderIcon, { backgroundColor: `${e.color}33` }]}>
                  <Ionicons name={expanded ? 'folder-open' : 'folder'} size={24} color={e.color} />
                </View>
                {unread && !expanded ? (
                  <View style={styles.badge}>
                    <Badge count={unread} />
                  </View>
                ) : null}
              </Pressable>
              {expanded ? e.servers.map(serverItem) : null}
            </View>
          )
        })}
        {servers.length ? <View style={styles.separator} /> : null}
        <Pressable style={styles.add} onPress={() => router.push('/server/create')} accessibilityRole="button" accessibilityLabel={t('rail.create')}>
          <Ionicons name="add" size={26} color={colors.success} />
        </Pressable>
        <Pressable style={styles.add} onPress={() => router.push('/server/join')} accessibilityRole="button" accessibilityLabel={t('rail.join')}>
          <Ionicons name="enter-outline" size={22} color={colors.success} />
        </Pressable>
        <Pressable style={styles.add} onPress={() => router.push('/server/explore')} accessibilityRole="button" accessibilityLabel={t('rail.explore')}>
          <Ionicons name="compass-outline" size={24} color={colors.success} />
        </Pressable>
      </ScrollView>
      {menu ? <ServerMenu server={menu} visible onClose={() => setMenu(null)} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  rail: { width: 72, backgroundColor: colors.bgDeep },
  item: { width: 72, alignItems: 'center', justifyContent: 'center' },
  pill: { position: 'absolute', left: 0, width: 4, borderTopRightRadius: 4, borderBottomRightRadius: 4, backgroundColor: colors.text },
  badge: { position: 'absolute', right: 8, bottom: -2 },
  separator: { width: 32, height: 2, borderRadius: 1, backgroundColor: colors.bgHover },
  home: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.bgAlt, alignItems: 'center', justifyContent: 'center' },
  homeActive: { borderRadius: 16, backgroundColor: colors.primary },
  folder: { alignItems: 'center', gap: spacing.sm, borderRadius: 24, paddingVertical: 2 },
  folderIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  add: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.bgAlt, alignItems: 'center', justifyContent: 'center' },
})
