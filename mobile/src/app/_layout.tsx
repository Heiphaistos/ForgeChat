import { QueryClientProvider } from '@tanstack/react-query'
import * as Linking from 'expo-linking'
import { DarkTheme, router, SplashScreen, Stack, ThemeProvider, usePathname } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { ActiveCallBar, BootOverlay, ConnectionBanner, EnvBanner, IncomingCallOverlay, LockOverlay, ScreenShareBanner } from '@/components/Overlays'
import { queryClient } from '@/lib/queryClient'
import { bindLifecycle, bindPrivacyScreen } from '@/services/lifecycle'
import { configureNotifications, listenNotificationTaps, syncPushRegistration } from '@/services/push'
import { bindRealtime } from '@/services/realtimeBindings'
import { useAuth } from '@/stores/auth'
import { replayablePath } from '@/lib/deepLinks'
import '@/stores/call' // enregistre les handlers d'appel entrant dès le démarrage
import { useLock } from '@/stores/lock'
import { useSettings } from '@/stores/settings'
import { colors } from '@/theme'

void SplashScreen.preventAutoHideAsync()
/** Le lien de lancement n'est rejoué qu'une fois par process (jamais après une reconnexion). */
let initialLinkReplayed = false
configureNotifications()

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.primary,
    background: colors.bg,
    card: colors.bgAlt,
    text: colors.text,
    border: colors.border,
    notification: colors.danger,
  },
}

export default function RootLayout() {
  const status = useAuth((s) => s.status)
  const hydrated = useSettings((s) => s.hydrated)
  const pushEnabled = useSettings((s) => s.pushEnabled)
  const pushPreview = useSettings((s) => s.pushPreview)

  // Démarrage : attendre les préférences (verrouillage) avant de restaurer la session.
  useEffect(() => {
    if (!hydrated) return
    if (useSettings.getState().appLock) useLock.getState().lockNow()
    void useAuth.getState().bootstrap()
  }, [hydrated])

  useEffect(() => {
    if (status !== 'booting') void SplashScreen.hideAsync()
  }, [status])

  useEffect(() => {
    const offs = [bindRealtime(), bindLifecycle(), bindPrivacyScreen()]
    return () => offs.forEach((off) => off())
  }, [])

  // Push : (ré)enregistrement une fois connecté et à chaque changement de préférence.
  useEffect(() => {
    if (status === 'signedIn') void syncPushRegistration()
  }, [status, pushEnabled, pushPreview])

  useEffect(() => {
    if (status === 'signedIn') return listenNotificationTaps()
  }, [status])

  // Lien profond reçu app fermée : voir lib/deepLinks. Rejoué une seule fois, après connexion.
  const pathname = usePathname()
  useEffect(() => {
    if (status !== 'signedIn' || initialLinkReplayed) return
    initialLinkReplayed = true
    void Linking.getInitialURL().then((url) => {
      const target = url ? replayablePath(url) : null
      if (target && target !== pathname) router.push(target)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seul le passage à signedIn compte
  }, [status])

  const signedIn = status === 'signedIn'

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bgDeep }}>
      <KeyboardProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider value={theme}>
            <StatusBar style="light" />
            <View style={{ flex: 1 }}>
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
                <Stack.Protected guard={signedIn}>
                  <Stack.Screen name="(app)" />
                </Stack.Protected>
                <Stack.Protected guard={!signedIn}>
                  <Stack.Screen name="(auth)" />
                </Stack.Protected>
                <Stack.Screen name="invite/[code]" options={{ presentation: 'modal' }} />
                <Stack.Screen name="friend-invite/[code]" options={{ presentation: 'modal' }} />
              </Stack>
              <ConnectionBanner />
              <ActiveCallBar />
              <ScreenShareBanner />
              <LockOverlay />
              {/* Au-dessus du verrou : on peut voir qui appelle ; décrocher exige de déverrouiller. */}
              <IncomingCallOverlay />
              <BootOverlay />
              <EnvBanner />
            </View>
          </ThemeProvider>
        </QueryClientProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  )
}
