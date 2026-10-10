// Icône d'application personnalisable (Apparence). 50 icônes prédéfinies
// (public/app-icons/N.png, scripts/gen-app-icons.py) ou une image importée.
// Bureau : PNG envoyé à Rust (systeme::set_app_icon) qui le pose sur la fenêtre,
// la barre des tâches et la zone de notification, et le réapplique au démarrage.
// Web : favicon de l'onglet, choix gardé dans le navigateur.
import { setFaviconOverride } from '../faviconAnimator'
import { desktopInvoke, isDesktop } from './desktop'

export const PRESET_COUNT = 50
export const presetUrl = (n: number) => `/app-icons/${n}.png`
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024
const ICON_SIZE = 256
const KEY = 'fc_app_icon'
const KEY_DATA = 'fc_app_icon_data'

/** Erreur d'import ; `code` = suffixe de la clé de traduction appIcon.<code>. */
export class IconError extends Error {
  constructor(public code: 'badType' | 'tooBig' | 'tooSmall' | 'unreadable') { super(code) }
}

const store = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string | null) => {
    try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch { /* sans mémoire : session seulement */ }
  },
}

/** Choix actuel : `preset:N`, `custom` ou null (icône d'origine). */
export async function currentIcon(): Promise<string | null> {
  if (isDesktop) return (await desktopInvoke<{ icon: string | null }>('system_get')).icon
  return store.get(KEY)
}

const blobToDataUrl = (b: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader()
  r.onload = () => res(r.result as string)
  r.onerror = () => rej(r.error)
  r.readAsDataURL(b)
})

/** Applique (et retient) une icône ; `png` requis sauf pour l'icône d'origine (id null). */
export async function setAppIcon(id: string | null, png?: Blob): Promise<void> {
  if (isDesktop) {
    const bytes = id && png ? new Uint8Array(await png.arrayBuffer()) : new Uint8Array()
    await desktopInvoke('set_app_icon', bytes, { 'x-icon-id': id ?? '' })
    return
  }
  const href = id && png ? (id === 'custom' ? await blobToDataUrl(png) : presetUrl(Number(id.split(':')[1]))) : null
  store.set(KEY, id && href ? id : null)
  store.set(KEY_DATA, id === 'custom' ? href : null)
  setFaviconOverride(href)
}

/** Web : réapplique le favicon choisi au chargement. */
export function initAppIcon() {
  if (isDesktop) return
  const id = store.get(KEY)
  const n = Number(id?.startsWith('preset:') ? id.slice(7) : NaN)
  const href = id === 'custom' ? store.get(KEY_DATA) : n >= 1 && n <= PRESET_COUNT ? presetUrl(n) : null
  if (href?.startsWith('data:image/png') || href?.startsWith('/app-icons/')) setFaviconOverride(href)
}

export async function fetchPreset(n: number): Promise<Blob> {
  const res = await fetch(presetUrl(n))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.blob()
}

const ACCEPTED = /^image\/(png|jpeg|x-icon|vnd\.microsoft\.icon)$/
const ACCEPTED_EXT = /\.(png|jpe?g|ico)$/i

/** Image importée (PNG, ICO, JPG ≤ 2 Mo, ≥ 16 px) → PNG carré 256 px, centrée sans déformation. */
export async function importIcon(file: File): Promise<Blob> {
  if (!ACCEPTED.test(file.type) && !ACCEPTED_EXT.test(file.name)) throw new IconError('badType')
  if (file.size > IMPORT_MAX_BYTES) throw new IconError('tooBig')
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    try { await img.decode() } catch { throw new IconError('unreadable') }
    const { naturalWidth: w, naturalHeight: h } = img
    if (Math.min(w, h) < 16) throw new IconError('tooSmall')
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = ICON_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new IconError('unreadable')
    const scale = ICON_SIZE / Math.max(w, h)
    const dw = w * scale, dh = h * scale
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, (ICON_SIZE - dw) / 2, (ICON_SIZE - dh) / 2, dw, dh)
    const png = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/png'))
    if (!png) throw new IconError('unreadable')
    return png
  } finally {
    URL.revokeObjectURL(url)
  }
}
