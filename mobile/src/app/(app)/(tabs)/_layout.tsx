import { Ionicons } from '@expo/vector-icons'
import { Tabs, router } from 'expo-router'
import { Pressable } from 'react-native'
import { useUi } from '@/stores/ui'
import { directUnread, useUnread } from '@/stores/unread'
import { useQuery } from '@tanstack/react-query'
import { friendsApi } from '@/api/friends'
import { qk } from '@/lib/queryClient'
import { useT } from '@/i18n'
import { unreadLabel } from '@/lib/format'
import { colors } from '@/theme'

export default function TabsLayout() {
  const t = useT()
  const counts = useUnread((s) => s.counts)
  const serverOf = useUnread((s) => s.serverOf)
  const dmUnread = directUnread(counts, serverOf)
  const friends = useQuery({ queryKey: qk.friends('pending'), queryFn: () => friendsApi.list('pending') })
  const pendingReceived = friends.data?.counts.pending_received ?? 0
  // Salon de serveur ouvert sur l'accueil : plein écran, sans barre d'onglets (comme Discord).
  const chatOpen = useUi((s) => s.chatOpen && s.selectedServerId !== null)
  const tabBarStyle = { backgroundColor: colors.bgDeep, borderTopColor: colors.border }

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bgAlt },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700' },
        tabBarStyle,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarBadgeStyle: { backgroundColor: colors.danger, fontSize: 10 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home'),
          tabBarAccessibilityLabel: dmUnread > 0 ? t('tabs.homeUnread', { unread: unreadLabel(dmUnread) }) : t('tabs.home'),
          headerShown: false,
          tabBarStyle: chatOpen ? { display: 'none' } : tabBarStyle,
          tabBarBadge: dmUnread > 0 ? (dmUnread > 99 ? '99+' : dmUnread) : undefined,
          tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? 'home' : 'home-outline'} size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="friends"
        options={{
          title: t('tabs.friends'),
          tabBarAccessibilityLabel:
            pendingReceived > 0 ? t(pendingReceived > 1 ? 'tabs.friendsPendingMany' : 'tabs.friendsPending', { n: pendingReceived }) : t('tabs.friends'),
          tabBarBadge: pendingReceived > 0 ? pendingReceived : undefined,
          tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? 'people' : 'people-outline'} size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="mentions"
        options={{
          title: t('tabs.mentions'),
          tabBarAccessibilityLabel: t('tabs.mentions'),
          tabBarIcon: ({ color }) => <Ionicons name="at" size={22} color={color} />,
          // Centre de notifications, à portée depuis la navigation principale (comme la cloche du web).
          headerRight: () => (
            <Pressable onPress={() => router.push('/notifications')} accessibilityRole="button" accessibilityLabel={t('ux.nc.open')} hitSlop={10} style={{ paddingHorizontal: 16 }}>
              <Ionicons name="options-outline" size={22} color={colors.text} />
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen
        name="you"
        options={{
          title: t('tabs.you'),
          tabBarAccessibilityLabel: t('tabs.you'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'person-circle' : 'person-circle-outline'} size={24} color={color} />
          ),
        }}
      />
    </Tabs>
  )
}
