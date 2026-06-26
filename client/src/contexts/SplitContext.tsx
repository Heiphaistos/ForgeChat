import { createContext } from 'react'

export const SplitContext = createContext<{
  splitChannelId: string | null
  setSplitChannelId: (id: string | null) => void
}>({
  splitChannelId: null,
  setSplitChannelId: () => {},
})
