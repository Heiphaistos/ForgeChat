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
  /** Confirmer avant d'ouvrir un lien externe. */
  confirmLinks: boolean
  /** Vérifier à l'ouverture (au plus toutes les 3 h) s'il existe une nouvelle version sur le serveur ForgeChat. */
  updateCheck: boolean
  /** Date (ms) de la dernière vérification automatique réussie. */
  updateLastCheckAt: number
  /** Version que l'utilisateur a choisi d'ignorer. */
  updateSkippedVersion: string | null
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
      confirmLinks: true,
      updateCheck: true,
      updateLastCheckAt: 0,
      updateSkippedVersion: null,
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
