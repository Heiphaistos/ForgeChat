// Salon à fils automatiques : nombre de réponses du fil de chaque message (id du message
// parent → nombre de messages du fil), fourni par ChannelPage et lu par MessageRow.
import { createContext } from 'react'

export const ThreadCountsContext = createContext<ReadonlyMap<string, number> | null>(null)
