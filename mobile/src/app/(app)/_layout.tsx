import { Stack } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import E2EGate from '@/e2e/E2EGate'
import { useAppearanceSync } from '@/features/appearance/sync'
import { useT } from '@/i18n'
import { colors } from '@/theme'

export const unstable_settings = { initialRouteName: '(tabs)' }

// Écrans qui gèrent eux-mêmes le bas de l'écran : barre d'onglets, zone de saisie (au-dessus du
// clavier), boutons d'appel et de vocal. Pas de marge supplémentaire pour eux.
const OWN_BOTTOM = { contentStyle: { backgroundColor: colors.bg, paddingBottom: 0 } }

export default function AppLayout() {
  // Affichage bord à bord : sans marge, la fin des listes passerait sous la barre de navigation
  // Android (3 boutons ou gestes).
  const { bottom } = useSafeAreaInsets()
  const t = useT()
  // Accent, format de l'heure et mode streamer choisis sur le web.
  useAppearanceSync()
  return (
    <>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bgAlt },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '700' },
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: colors.bg, paddingBottom: bottom },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false, ...OWN_BOTTOM }} />
        <Stack.Screen name="channel/[serverId]/[channelId]" options={{ title: '', ...OWN_BOTTOM }} />
        <Stack.Screen name="dm/[dmId]" options={{ title: '', ...OWN_BOTTOM }} />
        <Stack.Screen name="thread/[serverId]/[channelId]" options={{ title: t('screen.thread'), ...OWN_BOTTOM }} />
        <Stack.Screen name="forum/[serverId]/[channelId]/index" options={{ title: t('screen.forum') }} />
        <Stack.Screen name="forum/[serverId]/[channelId]/new" options={{ title: t('screen.newPost'), presentation: 'modal' }} />
        <Stack.Screen name="forum/[serverId]/[channelId]/[postId]" options={{ title: t('screen.post'), ...OWN_BOTTOM }} />
        <Stack.Screen name="group/[groupId]" options={{ title: '', ...OWN_BOTTOM }} />
        <Stack.Screen name="group/create" options={{ title: t('screen.newGroup'), presentation: 'modal' }} />
        <Stack.Screen name="group/manage/[groupId]" options={{ title: t('conv.manageGroup') }} />
        <Stack.Screen name="pins" options={{ title: t('screen.pins'), presentation: 'modal' }} />
        <Stack.Screen name="search" options={{ title: t('screen.search') }} />
        <Stack.Screen name="saved" options={{ title: t('you.saved') }} />
        <Stack.Screen name="scheduled" options={{ title: t('messaging.sched.title') }} />
        <Stack.Screen name="forward" options={{ title: t('screen.forward'), presentation: 'modal' }} />
        <Stack.Screen name="remind" options={{ title: t('screen.remind'), presentation: 'modal' }} />
        <Stack.Screen name="edits" options={{ title: t('screen.edits'), presentation: 'modal' }} />
        <Stack.Screen name="voice/[serverId]/[channelId]" options={{ title: t('screen.voice'), ...OWN_BOTTOM }} />
        <Stack.Screen name="call" options={{ headerShown: false, presentation: 'fullScreenModal', gestureEnabled: false, ...OWN_BOTTOM }} />
        <Stack.Screen name="group-call" options={{ headerShown: false, presentation: 'fullScreenModal', ...OWN_BOTTOM }} />
        <Stack.Screen name="server/join" options={{ title: t('screen.joinServer'), presentation: 'modal' }} />
        <Stack.Screen name="server/create" options={{ title: t('screen.createServer'), presentation: 'modal' }} />
        <Stack.Screen name="server/[serverId]/members" options={{ title: t('screen.members') }} />
        <Stack.Screen name="server/[serverId]/invite" options={{ title: t('screen.invite'), presentation: 'modal' }} />
        <Stack.Screen name="server/[serverId]/channel-create" options={{ title: t('screen.createChannel'), presentation: 'modal' }} />
        <Stack.Screen name="server/[serverId]/notifications" options={{ title: t('you.notifications') }} />
        <Stack.Screen name="server/[serverId]/nickname" options={{ title: t('menu.nickname'), presentation: 'modal' }} />
        <Stack.Screen name="server/[serverId]/delete" options={{ title: t('screen.deleteServer'), presentation: 'modal' }} />
        <Stack.Screen name="server/[serverId]/onboarding" options={{ title: t('menu.onboarding'), presentation: 'modal' }} />
        <Stack.Screen name="server/[serverId]/follow" options={{ title: t('screen.followChannel'), presentation: 'modal' }} />
        <Stack.Screen name="server/[serverId]/settings/onboarding" options={{ title: t('screen.onboardingSettings') }} />
        <Stack.Screen name="server/[serverId]/settings/index" options={{ title: t('screen.serverSettings') }} />
        <Stack.Screen name="server/[serverId]/settings/overview" options={{ title: t('screen.overview') }} />
        <Stack.Screen name="server/[serverId]/settings/channels" options={{ title: t('screen.channels') }} />
        <Stack.Screen name="server/[serverId]/settings/channel/[channelId]" options={{ title: t('screen.editChannel') }} />
        <Stack.Screen name="server/[serverId]/settings/roles" options={{ title: t('screen.roles') }} />
        <Stack.Screen name="server/[serverId]/settings/role/[roleId]" options={{ title: t('screen.editRole') }} />
        <Stack.Screen name="server/[serverId]/settings/member/[userId]" options={{ title: t('screen.manageMember') }} />
        <Stack.Screen name="server/[serverId]/settings/bans" options={{ title: t('screen.bans') }} />
        <Stack.Screen name="server/[serverId]/settings/invites" options={{ title: t('screen.invites') }} />
        <Stack.Screen name="server/[serverId]/settings/transfer" options={{ title: t('screen.transfer') }} />
        <Stack.Screen name="server/[serverId]/settings/encryption" options={{ title: t('e2e.serverKey.title') }} />
        <Stack.Screen name="user/[userId]" options={{ title: t('screen.profile'), presentation: 'modal' }} />
        <Stack.Screen name="friends/add" options={{ title: t('friends.add'), presentation: 'modal' }} />
        <Stack.Screen name="settings/profile" options={{ title: t('you.profile') }} />
        <Stack.Screen name="settings/security" options={{ title: t('screen.security') }} />
        <Stack.Screen name="settings/sessions" options={{ title: t('you.sessions') }} />
        <Stack.Screen name="settings/notifications" options={{ title: t('you.notifications') }} />
        <Stack.Screen name="settings/appearance" options={{ title: t('you.appearance') }} />
        <Stack.Screen name="settings/password" options={{ title: t('screen.password'), presentation: 'modal' }} />
        <Stack.Screen name="settings/delete-account" options={{ title: t('screen.deleteAccount'), presentation: 'modal' }} />
      </Stack>
      <E2EGate />
    </>
  )
}
