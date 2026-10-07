import { useEffect } from 'react'
import { AccessibilityInfo } from 'react-native'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { secureStateStorage } from '@/lib/secureStorage'

export type LockDelay = 0 | 30 | 60 | 300

interface SettingsState {
  /** Verrouillage biométrique / code de l'appareil à l'ouverture. */
  appLock: boolean
  /** Délai (s) en arrière-plan avant re-verrouillage. */
  lockDelay: LockDelay
  /** Floute l'app dans le sélecteur d'apps (iOS) / FLAG_SECURE (Android). */
  privacyScreen: boolean
  /** Notifications push activées sur cet appareil. */
  pushEnabled: boolean
  /** Afficher le contenu des messages dans les notifications. */
  pushPreview: boolean
  /** Android : connexion gardée en arrière-plan pour notifier sans Google (null : choix par défaut, services/keepAlive). */
  keepConnected: boolean | null
  /** Widgets Android : contenu des messages affiché (sinon noms et non-lus seulement). */
  widgetShowContent: boolean
  /** Confirmer avant d'ouvrir un lien externe. */
  confirmLinks: boolean
  /** Vérifier à l'ouverture (au plus toutes les 3 h) s'il existe une nouvelle version sur le serveur ForgeChat. */
  updateCheck: boolean
  /** Date (ms) de la dernière vérification automatique réussie. */
  updateLastCheckAt: number
  /** Version que l'utilisateur a choisi d'ignorer. */
  updateSkippedVersion: string | null
  /** Animer les avatars et bannières GIF/WebP (toujours forcé à non si « réduire les animations »). */
  animateAvatars: boolean
  hydrated: boolean
  set: (patch: Partial<Omit<SettingsState, 'set' | 'hydrated'>>) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      appLock: false,
      lockDelay: 30,
      privacyScreen: true,
      pushEnabled: true,
      pushPreview: false, // vie privée par défaut : pas de contenu sur l'écran verrouillé
      keepConnected: null,
      widgetShowContent: false,
      confirmLinks: true,
      updateCheck: true,
      updateLastCheckAt: 0,
      updateSkippedVersion: null,
      animateAvatars: true,
      hydrated: false,
      set: (patch) => set(patch),
    }),
    {
      name: 'fc.settings.v1',
      storage: createJSONStorage(() => secureStateStorage),
      partialize: ({ hydrated: _h, set: _s, ...rest }) => rest,
      onRehydrateStorage: () => () => {
        useSettings.setState({ hydrated: true })
      },
    },
  ),
)

/** « Réduire les animations » du système, suivi une seule fois pour toute l'app. */
const reduceMotion = create<{ on: boolean }>(() => ({ on: false }))
let watching = false
function watchReduceMotion() {
  if (watching) return
  watching = true
  void AccessibilityInfo.isReduceMotionEnabled().then((on) => reduceMotion.setState({ on }), () => undefined)
  AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => reduceMotion.setState({ on }))
}

/** Avatars / bannières animés : réglage local, coupé si le système réduit les animations. */
export function useAnimateAvatars(): boolean {
  useEffect(watchReduceMotion, [])
  const enabled = useSettings((s) => s.animateAvatars)
  const reduce = reduceMotion((s) => s.on)
  return enabled && !reduce
}
