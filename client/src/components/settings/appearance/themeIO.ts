import { decodeTheme, encodeTheme, isSafeImageUrl, toExport, type ThemeSpec } from '../../../theme/themeCore'

/** Télécharge le thème en fichier JSON (données uniquement, relu par decodeTheme à l'import). */
export function downloadTheme(spec: ThemeSpec) {
  const blob = new Blob([JSON.stringify(toExport(spec), null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${spec.name.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 40) || 'theme'}.forgechat-theme.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function copyThemeCode(spec: ThemeSpec): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(encodeTheme(spec))
    return true
  } catch {
    return false
  }
}

const MAX_THEME_FILE = 4 * 1024 * 1024

/** Fichier .json choisi par l'utilisateur → thème validé, ou null. */
export async function readThemeFile(file: File): Promise<ThemeSpec | null> {
  if (file.size > MAX_THEME_FILE) return null
  return decodeTheme(await file.text())
}

const MAX_IMAGE_FILE = 15 * 1024 * 1024
const MAX_SIDE = 1600

/**
 * Image locale → data:image/jpeg réduite (1600 px max) : tient dans le stockage et la synchronisation.
 * Le décodage passe par le navigateur (createImageBitmap) : un fichier qui n'est pas une image échoue.
 */
export async function imageFileToDataUrl(file: File): Promise<string | null> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > MAX_IMAGE_FILE) return null
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bmp.width * scale))
    canvas.height = Math.max(1, Math.round(bmp.height * scale))
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    bmp.close()
    const url = canvas.toDataURL('image/jpeg', 0.8)
    return isSafeImageUrl(url) ? url : null
  } catch {
    return null
  }
}
