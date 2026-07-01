export interface Sticker {
  id: string
  name: string
  category: string
  emoji?: string
  url?: string
}

export function formatStickerMessage(sticker: Sticker): string {
  if (sticker.url) return `[sticker:${sticker.name}](${sticker.url})`
  return `[sticker:${sticker.emoji ?? ''}:${sticker.name}]`
}

export function parseStickerMessage(content: string): { name: string; url?: string; emoji?: string } | null {
  const imgMatch = content.match(/^\[sticker:([^\]]+)\]\(([^)]+)\)$/)
  if (imgMatch) return { name: imgMatch[1], url: imgMatch[2] }
  const emojiMatch = content.match(/^\[sticker:(.+?):(.+?)\]$/)
  if (emojiMatch) return { emoji: emojiMatch[1], name: emojiMatch[2] }
  return null
}
