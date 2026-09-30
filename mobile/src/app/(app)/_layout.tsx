import { Stack } from 'expo-router'
import { colors } from '@/theme'

export const unstable_settings = { initialRouteName: '(tabs)' }

export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bgAlt },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700' },
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="channel/[serverId]/[channelId]" options={{ title: '' }} />
      <Stack.Screen name="dm/[dmId]" options={{ title: '' }} />
      <Stack.Screen name="group/[groupId]" options={{ title: '' }} />
      <Stack.Screen name="group/create" options={{ title: 'Nouveau groupe', presentation: 'modal' }} />
      <Stack.Screen name="group/manage/[groupId]" options={{ title: 'Gérer le groupe' }} />
      <Stack.Screen name="pins" options={{ title: 'Messages épinglés', presentation: 'modal' }} />
      <Stack.Screen name="search" options={{ title: 'Rechercher' }} />
      <Stack.Screen name="voice/[serverId]/[channelId]" options={{ title: 'Salon vocal' }} />
      <Stack.Screen name="call" options={{ headerShown: false, presentation: 'fullScreenModal', gestureEnabled: false }} />
      <Stack.Screen name="server/join" options={{ title: 'Rejoindre un serveur', presentation: 'modal' }} />
      <Stack.Screen name="server/create" options={{ title: 'Créer un serveur', presentation: 'modal' }} />
      <Stack.Screen name="server/[serverId]/members" options={{ title: 'Membres' }} />
      <Stack.Screen name="server/[serverId]/invite" options={{ title: 'Inviter', presentation: 'modal' }} />
      <Stack.Screen name="server/[serverId]/channel-create" options={{ title: 'Créer un salon', presentation: 'modal' }} />
      <Stack.Screen name="user/[userId]" options={{ title: 'Profil', presentation: 'modal' }} />
      <Stack.Screen name="friends/add" options={{ title: 'Ajouter un ami', presentation: 'modal' }} />
      <Stack.Screen name="settings/profile" options={{ title: 'Mon profil' }} />
      <Stack.Screen name="settings/security" options={{ title: 'Sécurité' }} />
      <Stack.Screen name="settings/sessions" options={{ title: 'Appareils connectés' }} />
      <Stack.Screen name="settings/notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="settings/password" options={{ title: 'Mot de passe', presentation: 'modal' }} />
      <Stack.Screen name="settings/delete-account" options={{ title: 'Supprimer le compte', presentation: 'modal' }} />
    </Stack>
  )
}
