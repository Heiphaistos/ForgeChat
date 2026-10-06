import * as LocalAuthentication from 'expo-local-authentication'
import { create } from 'zustand'
import { useSettings } from './settings'

/**
 * Verrouillage applicatif (biométrie ou code de l'appareil).
 * L'état « verrouillé » masque TOUTE l'UI (écran opaque) tant que
 * l'authentification locale n'a pas réussi.
 */
interface LockState {
  locked: boolean
  authenticating: boolean
  backgroundedAt: number | null
  lockNow: () => void
  unlock: () => Promise<boolean>
  onBackground: () => void
  onForeground: () => void
}

export async function biometricAvailability() {
  const [hasHardware, enrolled, level] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.getEnrolledLevelAsync(),
  ])
  // SECRET = code/mot de passe de l'appareil ; BIOMETRIC_* = empreinte/visage.
  return { hasHardware, enrolled, usable: level !== LocalAuthentication.SecurityLevel.NONE }
}

export const useLock = create<LockState>((set, get) => ({
  locked: false,
  authenticating: false,
  backgroundedAt: null,

  lockNow: () => {
    if (useSettings.getState().appLock) set({ locked: true })
  },

  unlock: async () => {
    if (get().authenticating) return false
    set({ authenticating: true })
    try {
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Déverrouiller ForgeChat',
        cancelLabel: 'Annuler',
        disableDeviceFallback: false, // repli sur le code de l'appareil
      })
      if (res.success) set({ locked: false })
      return res.success
    } finally {
      set({ authenticating: false })
    }
  },

  onBackground: () => {
    // Le prompt biométrique lui-même fait passer l'app en « background » sur Android.
    if (get().authenticating) return
    set({ backgroundedAt: Date.now() })
  },

  onForeground: () => {
    const { appLock, lockDelay } = useSettings.getState()
    const since = get().backgroundedAt
    set({ backgroundedAt: null })
    if (!appLock || since === null) return
    if (Date.now() - since >= lockDelay * 1000) set({ locked: true })
  },
}))
