import { safeEmojiUrl } from '@/features/chat/customEmojis'

/** Sticker image d'un serveur (GET /servers/:id/stickers). */
export interface ServerSticker {
  id: string
  name: string
  /** Chemin tel que renvoyé par le serveur (/uploads/stickers/…) : c'est lui qui part dans le message. */
  url: string
  /** Adresse affichable, validée (serveur ou https). */
  src: string
}

const NAME = /^[^\]\n]{1,64}$/

/** Liste des stickers du serveur ; entrées invalides (nom, URL refusée) ignorées. */
export function parseServerStickers(list: unknown): ServerSticker[] {
  if (!Array.isArray(list)) return []
  const out: ServerSticker[] = []
  for (const s of list as Record<string, unknown>[]) {
    const url = typeof s?.url === 'string' ? s.url : ''
    const src = safeEmojiUrl(url)
    if (typeof s?.id === 'string' && typeof s.name === 'string' && NAME.test(s.name) && src && !url.includes(')')) {
      out.push({ id: s.id, name: s.name, url, src })
    }
  }
  return out
}
