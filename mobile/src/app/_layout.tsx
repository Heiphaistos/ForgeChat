import '@/services/livekitSetup' // en premier : globales WebRTC de LiveKit
import { QueryClientProvider } from '@tanstack/react-query'
import * as Linking from 'expo-linking'
import { DarkTheme, DefaultTheme, router, SplashScreen, Stack, ThemeProvider, usePathname } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SystemUI from 'expo-system-ui'
import { useEffect } from 'react'
import { View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { ActiveCallBar, ApiHealthBanner, BootOverlay, ConnectionBanner, EnvBanner, GroupRingOverlay, IncomingCallOverlay, LockOverlay, ScreenShareBanner } from '@/components/Overlays'
import { loadServerChoice } from '@/config/env'
import { queryClient } from '@/lib/queryClient'
import { bindLifecycle, bindPrivacyScreen } from '@/services/lifecycle'
import { UpdateBanner } from '@/features/updates/UpdateBanner'
import { useUpdateCheck } from '@/features/updates/useUpdateCheck'
import { bindKeepAlive, syncKeepAlive, useKeepAlive } from '@/services/keepAlive'
import { configureNotifications, listenNotificationTaps, syncPushRegistration } from '@/services/push'
import { bindRealtime } from '@/services/realtimeBindings'
import { bindMessaging } from '@/services/messagingBindings'
import { listenMessageActions } from '@/services/notificationActions'
import { bindVoiceRooms } from '@/stores/voiceRooms'
import { useAuth } from '@/stores/auth'
import { replayablePath } from '@/lib/deepLinks'
import '@/stores/call' // enregistre les handlers d'appel entrant dès le démarrage
import '@/stores/groupCall' // sonnerie des appels de groupe
import '@/stores/voice' // reprise du vocal à la reconnexion du WebSocket
import '@/stores/voiceExtras' // salle d'attente, appuyer pour parler, effets locaux
import { useLock } from '@/stores/lock'
import { bindOutbox } from '@/services/outbox'
import { bindWidgets } from '@/services/widgets'
import { useSettings } from '@/stores/settings'
import { colors, isLight } from '@/theme'
import { clearFileCache } from '@/e2e/files'
import { loadNameFonts } from '@/components/nameFonts'

void SplashScreen.preventAutoHideAsync()
/** Le lien de lancement n'est rejoué qu'une fois par process (jamais après une reconnexion). */
let initialLinkReplayed = false
configureNotifications()
// Fond de la fenêtre native (visible derrière le clavier et pendant les transitions) : celui du thème.
void SystemUI.setBackgroundColorAsync(colors.bgDeep).catch(() => undefined)

const baseTheme = isLight ? DefaultTheme : DarkTheme
const theme = {
  ...baseTheme,
  colors: {
    ...baseTheme.colors,
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
  // Nouvelle version sur le serveur ForgeChat : vérifiée même déconnecté (serveur en panne, compte à créer…).
  useUpdateCheck()
  const pushEnabled = useSettings((s) => s.pushEnabled)
  const pushPreview = useSettings((s) => s.pushPreview)
  const keepConnected = useSettings((s) => s.keepConnected)
  const keepAlive = useKeepAlive((s) => s.active)

  // Polices embarquées du pseudo (expo-font) : chargées en tâche de fond, police système en attendant.
  useEffect(() => {
    void loadNameFonts()
  }, [])

  // Démarrage : attendre les préférences (verrouillage) avant de restaurer la session.
  useEffect(() => {
    if (!hydrated) return
    if (useSettings.getState().appLock) useLock.getState().lockNow()
    // Serveur choisi dans l'APK DEV d'abord (no-op en production), puis la session.
    void loadServerChoice().finally(() => void useAuth.getState().bootstrap())
  }, [hydrated])

  useEffect(() => {
    if (status !== 'booting') void SplashScreen.hideAsync()
    // Fichiers déchiffrés temporaires (§12) : effacés au démarrage et à la déconnexion.
    if (status !== 'signedIn') clearFileCache()
  }, [status])

  useEffect(() => {
    const offs = [bindRealtime(), bindVoiceRooms(), bindLifecycle(), bindPrivacyScreen(), bindKeepAlive(), bindOutbox(), bindWidgets(), bindMessaging()]
    return () => offs.forEach((off) => off())
  }, [])

  // Push : (ré)enregistrement une fois connecté et à chaque changement de préférence. Puis le mode
  // « Notifications sans Google », actif par défaut sans jeton push (arrêté hors session).
  useEffect(() => {
    if (status === 'signedIn') void syncPushRegistration().catch(() => undefined).then(syncKeepAlive)
    else void syncKeepAlive()
  }, [status, pushEnabled, pushPreview, keepConnected])

  useEffect(() => {
    if (status === 'signedIn') return listenNotificationTaps(keepAlive)
  }, [status, keepAlive])
  // Réponse rapide et réactions depuis une notification (texte toujours chiffré).
  useEffect(() => {
    if (status === 'signedIn') return listenMessageActions()
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
            <StatusBar style={isLight ? 'dark' : 'light'} />
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
              <ApiHealthBanner />
              <UpdateBanner />
              <ActiveCallBar />
              <ScreenShareBanner />
              <LockOverlay />
              {/* Au-dessus du verrou : on peut voir qui appelle ; décrocher exige de déverrouiller. */}
              <GroupRingOverlay />
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
