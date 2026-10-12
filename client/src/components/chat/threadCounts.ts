// Fils de chaque message (id du message parent → nombre de réponses, non lus, dernière réponse),
// fourni par ChannelPage et lu par MessageRow. Tous les salons (amélioration n° 32 du 2026-10-12),
// plus seulement ceux à fils automatiques.
import { createContext } from 'react'

export interface ThreadInfo { count: number; unread: number; lastReplyAt: string | null }

export const ThreadCountsContext = createContext<ReadonlyMap<string, ThreadInfo> | null>(null)
