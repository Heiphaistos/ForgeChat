import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Room } from 'livekit-client'
import { secureStateStorage } from '@/lib/secureStorage'

/**
 * Volume par personne (1 = 100 %, jusqu'à 2 = 200 %) : un seul réglage par utilisateur, appliqué
 * dans les salons vocaux, les appels MP et de groupe. LiveKit RN le passe au gain natif de WebRTC
 * (`AudioTrack.setVolume` Android, `RTCAudioSource.volume` iOS, plage 0 à 10) : 200 % amplifie
 * réellement. Seules les valeurs différentes de 100 % sont gardées (SecureStore : ~2 Ko par valeur).
 */
export const VOLUME_STEPS = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const
const MAX_KEPT = 40

export function clampVolume(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.min(2, Math.max(0, n)) : 1
}

/** Nouvelle table : 100 % retiré, au plus MAX_KEPT réglages (les plus anciens tombent). */
export function withVolume(volumes: Record<string, number>, userId: string, volume: number): Record<string, number> {
  const { [userId]: _old, ...rest } = volumes
  const v = clampVolume(volume)
  const next = v === 1 ? rest : { ...rest, [userId]: v }
  const keys = Object.keys(next)
  return keys.length > MAX_KEPT ? Object.fromEntries(keys.slice(-MAX_KEPT).map((k) => [k, next[k]!])) : next
}

interface PeerVolumesState {
  volumes: Record<string, number>
  /** Rendus muets pour moi seul (menu vocal) : silencieux sans perdre leur volume. */
  muted: string[]
  setVolume: (userId: string, volume: number) => void
  setMuted: (userId: string, on: boolean) => void
}

export const usePeerVolumes = create<PeerVolumesState>()(
  persist(
    (set) => ({
      volumes: {},
      muted: [],
      setVolume: (userId, volume) => set((s) => ({ volumes: withVolume(s.volumes, userId, volume) })),
      setMuted: (userId, on) =>
        set((s) => ({ muted: on ? [...new Set([...s.muted, userId])].slice(-MAX_KEPT) : s.muted.filter((x) => x !== userId) })),
    }),
    {
      name: 'fc.peerVolumes.v1',
      storage: createJSONStorage(() => secureStateStorage),
      partialize: ({ volumes, muted }) => ({ volumes, muted }),
    },
  ),
)

/** Volume appliqué : 0 si rendu muet pour moi, sinon le réglage mémorisé. */
export const peerVolume = (userId: string): number => {
  const s = usePeerVolumes.getState()
  return s.muted.includes(userId) ? 0 : clampVolume(s.volumes[userId] ?? 1)
}

/** Applique les volumes mémorisés à tous les participants distants d'une salle. */
export function applyPeerVolumes(room: Room | null | undefined) {
  room?.remoteParticipants.forEach((p) => p.setVolume(peerVolume(p.identity)))
}
