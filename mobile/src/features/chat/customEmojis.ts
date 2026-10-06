import { createContext, useContext } from 'react'
import { parseSafeUrl, resolveMediaUrl } from '@/lib/links'

/** Réponse de GET /servers/:id/emojis (handlers/emojis.rs). */
export interface CustomEmoji {
  id: string
  name: string
  url: string
  animated: boolean
}

/** Noms reconnus dans le texte et les réactions sous la forme « :nom: » (comme le client web). */
const NAME = /^[A-Za-z0-9_]{1,32}$/
const REACTION = /^:([A-Za-z0-9_]{1,32}):$/

/**
 * URL d'image d'emoji autorisée : chemin /uploads/ du serveur, ou https. Rien d'autre
 * (ni http, même en dev, ni data:, ni chemin relatif détourné).
 */
export function safeEmojiUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null
  if (url.startsWith('/uploads/')) {
    if (url.includes('..') || url.includes('\\') || /[?#]/.test(url)) return null
    return resolveMediaUrl(url)
  }
  const u = parseSafeUrl(url)
  return u && u.protocol === 'https:' ? resolveMediaUrl(u.toString()) : null
}

/** Table nom → URL ; entrées au nom invalide ou à l'URL refusée ignorées. Premier arrivé gagne. */
export function buildEmojiMap(list: unknown): ReadonlyMap<string, string> {
  const map = new Map<string, string>()
  if (!Array.isArray(list)) return map
  for (const e of list as Partial<CustomEmoji>[]) {
    const url = safeEmojiUrl(e?.url)
    if (typeof e?.name === 'string' && NAME.test(e.name) && url && !map.has(e.name)) map.set(e.name, url)
  }
  return map
}

/** « :nom: » → « nom » pour une réaction personnalisée, sinon null (emoji Unicode). */
export function reactionEmojiName(emoji: string): string | null {
  return REACTION.exec(emoji)?.[1] ?? null
}

/** Emojis du serveur de la conversation affichée (vide en DM / groupe). */
export const CustomEmojiContext = createContext<ReadonlyMap<string, string>>(new Map())
export const useCustomEmojis = () => useContext(CustomEmojiContext)
