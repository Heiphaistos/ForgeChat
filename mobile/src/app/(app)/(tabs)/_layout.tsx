import { Ionicons } from '@expo/vector-icons'
import { Tabs } from 'expo-router'
import { directUnread, useUnread } from '@/stores/unread'
import { useQuery } from '@tanstack/react-query'
import { friendsApi } from '@/api/friends'
import { qk } from '@/lib/queryClient'
import { colors } from '@/theme'

export default function TabsLayout() {
  const counts = useUnread((s) => s.counts)
  const serverOf = useUnread((s) => s.serverOf)
  const dmUnread = directUnread(counts, serverOf)
  const friends = useQuery({ queryKey: qk.friends('pending'), queryFn: () => friendsApi.list('pending') })
  const pendingReceived = friends.data?.counts.pending_received ?? 0

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bgAlt },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700' },
        tabBarStyle: { backgroundColor: colors.bgDeep, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarBadgeStyle: { backgroundColor: colors.danger, fontSize: 10 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Accueil',
          tabBarAccessibilityLabel: dmUnread > 0 ? `Accueil, ${dmUnread} non lu${dmUnread > 1 ? 's' : ''}` : 'Accueil',
          headerShown: false,
          tabBarBadge: dmUnread > 0 ? (dmUnread > 99 ? '99+' : dmUnread) : undefined,
          tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? 'home' : 'home-outline'} size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="friends"
        options={{
          title: 'Amis',
          tabBarAccessibilityLabel: pendingReceived > 0 ? `Amis, ${pendingReceived} demande${pendingReceived > 1 ? 's' : ''} reçue${pendingReceived > 1 ? 's' : ''}` : 'Amis',
          tabBarBadge: pendingReceived > 0 ? pendingReceived : undefined,
          tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? 'people' : 'people-outline'} size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="mentions"
        options={{
          title: 'Mentions',
          tabBarAccessibilityLabel: 'Mentions',
          tabBarIcon: ({ color }) => <Ionicons name="at" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="you"
        options={{
          title: 'Vous',
          tabBarAccessibilityLabel: 'Vous',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'person-circle' : 'person-circle-outline'} size={24} color={color} />
          ),
        }}
      />
    </Tabs>
  )
}
