import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { rememberChannel } from '@/features/servers/channels'
import { secureStateStorage } from '@/lib/secureStorage'

/** Dernier salon texte consulté par serveur (sur cet appareil), pour y revenir en touchant le serveur, comme Discord. */
export const useLastChannel = create<{ byServer: Record<string, string>; remember: (serverId: string, channelId: string) => void }>()(
  persist(
    (set) => ({
      byServer: {},
      remember: (serverId, channelId) =>
        set((s) => (s.byServer[serverId] === channelId ? s : { byServer: rememberChannel(s.byServer, serverId, channelId) })),
    }),
    {
      name: 'fc.lastChannel.v1',
      storage: createJSONStorage(() => secureStateStorage),
      partialize: ({ byServer }) => ({ byServer }),
    },
  ),
)
