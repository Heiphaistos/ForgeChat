import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { secureStateStorage } from '@/lib/secureStorage'

export type NoiseLevel = 'off' | 'standard' | 'strong'
export type CameraBackground = 'none' | 'blur' | 'image'

/** Réglages « Voix et vidéo » de cet appareil (écran Réglages > Voix et vidéo). */
interface VoiceFxState {
  /** Suppression de bruit : off (musique, chant), standard (WebRTC), forte (WebRTC + porte de bruit native). */
  noise: NoiseLevel
  /** Fond virtuel de la caméra (Android). */
  background: CameraBackground
  /** Image de fond copiée dans les fichiers de l'app (chemin natif), ou null. */
  backgroundImage: string | null
  /** Android : appuyer pour parler avec la touche volume bas pendant un salon vocal. */
  volumePtt: boolean
  set: (patch: Partial<Omit<VoiceFxState, 'set'>>) => void
}

export const useVoiceFx = create<VoiceFxState>()(
  persist(
    (set) => ({
      noise: 'standard',
      background: 'none',
      backgroundImage: null,
      volumePtt: false,
      set: (patch) => set(patch),
    }),
    {
      name: 'fc.voicefx.v1',
      storage: createJSONStorage(() => secureStateStorage),
      partialize: ({ set: _s, ...rest }) => rest,
    },
  ),
)
