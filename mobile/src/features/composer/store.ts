import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { secureStateStorage } from '@/lib/secureStorage'
import { DEFAULT_QUICK_REPLIES, RECENT_EMOJIS_MAX, type QuickReply } from './data'

/** Bornes des réponses rapides (stockées sur l'appareil seulement, comme le web). */
export const QUICK_REPLY_LIMITS = { count: 10, label: 30, content: 300 } as const

/**
 * Nettoie une liste de réponses rapides : champs tronqués, réponses sans contenu retirées, au plus
 * `count` entrées. Une liste vide redonne les réponses par défaut (comme le web).
 */
export function normalizeQuickReplies(list: readonly Partial<QuickReply>[]): QuickReply[] {
  const out: QuickReply[] = []
  for (const r of list) {
    const content = (r.content ?? '').trim().slice(0, QUICK_REPLY_LIMITS.content)
    if (!content) continue
    const label = (r.label ?? '').trim().slice(0, QUICK_REPLY_LIMITS.label) || content.slice(0, QUICK_REPLY_LIMITS.label)
    out.push({ id: typeof r.id === 'string' && r.id ? r.id : String(Date.now() + out.length), label, content })
    if (out.length >= QUICK_REPLY_LIMITS.count) break
  }
  return out.length ? out : [...DEFAULT_QUICK_REPLIES]
}

/** Emoji utilisé : en tête de liste, sans doublon, au plus RECENT_EMOJIS_MAX. */
export function pushRecent(recent: readonly string[], emoji: string): string[] {
  return [emoji, ...recent.filter((e) => e !== emoji)].slice(0, RECENT_EMOJIS_MAX)
}

interface ComposerPrefs {
  quickReplies: QuickReply[]
  recentEmojis: string[]
  setQuickReplies: (list: readonly Partial<QuickReply>[]) => void
  rememberEmoji: (emoji: string) => void
}

/** Préférences de la barre de saisie, gardées sur l'appareil (jamais envoyées au serveur). */
export const useComposerPrefs = create<ComposerPrefs>()(
  persist(
    (set) => ({
      quickReplies: [...DEFAULT_QUICK_REPLIES],
      recentEmojis: [],
      setQuickReplies: (list) => set({ quickReplies: normalizeQuickReplies(list) }),
      rememberEmoji: (emoji) => set((s) => ({ recentEmojis: pushRecent(s.recentEmojis, emoji) })),
    }),
    {
      name: 'fc.composer.v1',
      storage: createJSONStorage(() => secureStateStorage),
      partialize: ({ quickReplies, recentEmojis }) => ({ quickReplies, recentEmojis }),
    },
  ),
)
