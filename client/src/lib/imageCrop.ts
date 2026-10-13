// Recadrage carré d'avatar (audit C18) : logique pure, testée par scripts/imageCrop.test.mjs.

/** Carré source en pixels de l'image : coin haut-gauche (x, y) et côté. */
export interface Crop { x: number; y: number; side: number }

/**
 * Carré de côté min(w, h) / zoom, recentré sur (cx, cy) puis ramené dans l'image.
 * zoom < 1 traité comme 1 : le carré ne sort jamais de l'image.
 */
export function squareCrop(w: number, h: number, zoom: number, cx: number, cy: number): Crop {
  const side = Math.min(w, h) / Math.max(1, zoom)
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max)
  return { x: clamp(cx - side / 2, w - side), y: clamp(cy - side / 2, h - side), side }
}

const ascii = (b: Uint8Array, at: number, s: string) =>
  [...s].every((c, i) => b[at + i] === c.charCodeAt(0))

/**
 * Image animée d'après son en-tête : GIF, PNG avec chunk acTL (APNG, placé avant IDAT),
 * WebP VP8X avec le drapeau animation. Le canvas n'en garderait que la 1re image.
 * ponytail: un GIF d'une seule image est aussi contourné (pas de recadrage) ; parser les
 * blocs GIF si ça gêne.
 */
export function isAnimatedImage(head: Uint8Array): boolean {
  if (ascii(head, 0, 'GIF8')) return true
  if (ascii(head, 0, 'RIFF') && ascii(head, 8, 'WEBP')) return ascii(head, 12, 'VP8X') && (head[20] & 0x02) !== 0
  if (head[0] === 0x89 && ascii(head, 1, 'PNG')) {
    // Parcours des chunks : longueur (4 octets big-endian), type (4), données, CRC (4).
    let at = 8
    while (at + 8 <= head.length) {
      if (ascii(head, at + 4, 'acTL')) return true
      if (ascii(head, at + 4, 'IDAT')) return false
      const len = ((head[at] << 24) | (head[at + 1] << 16) | (head[at + 2] << 8) | head[at + 3]) >>> 0
      at += 12 + len
    }
  }
  return false
}
