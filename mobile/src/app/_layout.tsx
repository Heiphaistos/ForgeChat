import { QueryClientProvider } from '@tanstack/react-query'
import { DarkTheme, SplashScreen, Stack, ThemeProvider } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { ActiveCallBar, BootOverlay, ConnectionBanner, IncomingCallOverlay, LockOverlay } from '@/components/Overlays'
import { queryClient } from '@/lib/queryClient'
import { bindLifecycle, bindPrivacyScreen } from '@/services/lifecycle'
import { configureNotifications, listenNotificationTaps, syncPushRegistration } from '@/services/push'
import { bindRealtime } from '@/services/realtimeBindings'
import { useAuth } from '@/stores/auth'
import '@/stores/call' // enregistre les handlers d'appel entrant dès le démarrage
import { useLock } from '@/stores/lock'
import { useSettings } from '@/stores/settings'
import { colors } from '@/theme'

void SplashScreen.preventAutoHideAsync()
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
              <LockOverlay />
              {/* Au-dessus du verrou : on peut voir qui appelle ; décrocher exige de déverrouiller. */}
              <IncomingCallOverlay />
              <BootOverlay />
            </View>
          </ThemeProvider>
        </QueryClientProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  )
}
