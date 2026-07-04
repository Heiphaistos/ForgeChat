// Compression côté client des photos avant upload.
// Cible : les JPEG volumineux (photos mobiles 8-12 Mo) → redimensionnés à
// 2048px max et ré-encodés qualité 0.85, soit ~10x plus léger.
// PNG (transparence), GIF (animation) et WebP ne sont jamais touchés.

const COMPRESS_THRESHOLD = 1.5 * 1024 * 1024
const MAX_DIM = 2048
const JPEG_QUALITY = 0.85

export async function maybeCompressImage(file: File): Promise<File> {
  if (file.type !== 'image/jpeg' || file.size < COMPRESS_THRESHOLD) return file
  try {
    // imageOrientation:'from-image' applique la rotation EXIF (photos mobiles)
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
    const scale = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name, { type: 'image/jpeg', lastModified: file.lastModified })
  } catch {
    return file
  }
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} Mo`
  if (n >= 1024) return `${Math.round(n / 1024)} Ko`
  return `${n} o`
}
